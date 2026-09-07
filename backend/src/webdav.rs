use crate::error::{error, Result};
use opendal::{raw::*, Buffer, Error, ErrorKind, Metadata};
use std::{fmt, sync::Arc};
use tokio::{sync::mpsc, task::JoinHandle};

// OpenDAL's WebDAV service only supports one-shot PUT. This layer adds bounded HTTP body streaming.
#[derive(Clone)]
pub struct StreamingLayer {
    client: reqwest::Client,
    endpoint: url::Url,
    root: String,
    username: String,
    password: String,
    bearer: Option<String>,
}

impl fmt::Debug for StreamingLayer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WebdavStreamingLayer { credentials: REDACTED }")
    }
}

impl StreamingLayer {
    pub fn new(
        endpoint: &str,
        root: &str,
        username: &str,
        password: &str,
        bearer: Option<&str>,
    ) -> Result<Self> {
        let endpoint = url::Url::parse(endpoint)
            .map_err(|_| error("configuration", "Invalid WebDAV endpoint"))?;
        if !matches!(endpoint.scheme(), "http" | "https")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(error(
                "configuration",
                "WebDAV endpoint must be an HTTP(S) URL without credentials, query or fragment",
            ));
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| error("configuration", "Cannot initialize WebDAV HTTP client"))?;
        Ok(Self {
            client,
            endpoint,
            root: root.into(),
            username: username.into(),
            password: password.into(),
            bearer: bearer.map(str::to_owned),
        })
    }
    fn url(&self, path: &str) -> opendal::Result<url::Url> {
        let mut url = self.endpoint.clone();
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| Error::new(ErrorKind::ConfigInvalid, "Invalid WebDAV endpoint"))?;
            segments.pop_if_empty();
            segments.extend(self.root.split('/').filter(|s| !s.is_empty()));
            segments.extend(path.split('/').filter(|s| !s.is_empty()));
        }
        Ok(url)
    }
}

#[derive(Debug)]
pub struct StreamingAccess<A> {
    inner: A,
    config: StreamingLayer,
    info: Arc<AccessorInfo>,
}

impl<A: Access> Layer<A> for StreamingLayer {
    type LayeredAccess = StreamingAccess<A>;
    fn layer(&self, inner: A) -> Self::LayeredAccess {
        let info = inner.info();
        info.update_full_capability(|mut c| {
            c.write_can_multi = true;
            c
        });
        StreamingAccess {
            inner,
            config: self.clone(),
            info,
        }
    }
}

impl<A: Access> LayeredAccess for StreamingAccess<A> {
    type Inner = A;
    type Reader = A::Reader;
    type Writer = StreamingWriter;
    type Lister = A::Lister;
    type Deleter = A::Deleter;
    type Copier = A::Copier;
    fn inner(&self) -> &A {
        &self.inner
    }
    fn info(&self) -> Arc<AccessorInfo> {
        self.info.clone()
    }
    async fn read(&self, path: &str, args: OpRead) -> opendal::Result<(RpRead, Self::Reader)> {
        self.inner.read(path, args).await
    }
    async fn list(&self, path: &str, args: OpList) -> opendal::Result<(RpList, Self::Lister)> {
        self.inner.list(path, args).await
    }
    async fn delete(&self) -> opendal::Result<(RpDelete, Self::Deleter)> {
        self.inner.delete().await
    }
    async fn copy(
        &self,
        from: &str,
        to: &str,
        args: OpCopy,
        opts: OpCopier,
    ) -> opendal::Result<(RpCopy, Self::Copier)> {
        self.inner.copy(from, to, args, opts).await
    }
    async fn write(&self, path: &str, args: OpWrite) -> opendal::Result<(RpWrite, Self::Writer)> {
        if args.append() {
            return Err(Error::new(
                ErrorKind::Unsupported,
                "WebDAV append is not supported",
            ));
        }
        let mut request = self.config.client.put(self.config.url(path)?);
        request = if let Some(token) = &self.config.bearer {
            request.bearer_auth(token)
        } else {
            request.basic_auth(&self.config.username, Some(&self.config.password))
        };
        if args.if_not_exists() {
            request = request.header(reqwest::header::IF_NONE_MATCH, "*");
        }
        if let Some(etag) = args.if_match() {
            request = request.header(reqwest::header::IF_MATCH, etag);
        }
        if let Some(content_type) = args.content_type() {
            request = request.header(reqwest::header::CONTENT_TYPE, content_type);
        }
        let (sender, receiver) = mpsc::channel::<Buffer>(1);
        let stream = futures::stream::unfold(receiver, |mut receiver| async move {
            receiver
                .recv()
                .await
                .map(|buffer| (Ok::<_, std::io::Error>(buffer.to_bytes()), receiver))
        });
        let task = tokio::spawn(async move {
            let response = request
                .body(reqwest::Body::wrap_stream(stream))
                .send()
                .await
                .map_err(|_| Error::new(ErrorKind::Unexpected, "WebDAV streaming PUT failed"))?;
            let status = response.status();
            if status.is_success() {
                return Ok(Metadata::default());
            }
            let kind = match status.as_u16() {
                401 | 403 => ErrorKind::PermissionDenied,
                404 => ErrorKind::NotFound,
                409 | 412 => ErrorKind::ConditionNotMatch,
                429 => ErrorKind::RateLimited,
                405 | 411 | 501 => ErrorKind::Unsupported,
                _ => ErrorKind::Unexpected,
            };
            Err(Error::new(kind, "WebDAV server rejected streaming PUT"))
        });
        Ok((
            RpWrite::new(),
            StreamingWriter {
                sender: Some(sender),
                task: Some(task),
            },
        ))
    }
}

pub struct StreamingWriter {
    sender: Option<mpsc::Sender<Buffer>>,
    task: Option<JoinHandle<opendal::Result<Metadata>>>,
}

impl StreamingWriter {
    async fn response(&mut self) -> opendal::Result<Metadata> {
        let task = self
            .task
            .as_mut()
            .ok_or_else(|| Error::new(ErrorKind::Unexpected, "WebDAV writer is closed"))?;
        let result = task
            .await
            .map_err(|_| Error::new(ErrorKind::Unexpected, "WebDAV streaming task stopped"))?;
        self.task.take();
        result
    }
}

impl oio::Write for StreamingWriter {
    async fn write(&mut self, buffer: Buffer) -> opendal::Result<()> {
        let sender = self
            .sender
            .as_ref()
            .ok_or_else(|| Error::new(ErrorKind::Unexpected, "WebDAV writer is closed"))?;
        // Split callers' inline buffers too; the HTTP queue never retains a frame-sized buffer.
        for chunk in buffer.to_bytes().chunks(crate::operations::BUFFER_SIZE) {
            if sender.send(chunk.to_vec().into()).await.is_err() {
                return self.response().await.and_then(|_| {
                    Err(Error::new(
                        ErrorKind::Unexpected,
                        "WebDAV PUT closed before all data was sent",
                    ))
                });
            }
        }
        Ok(())
    }
    async fn close(&mut self) -> opendal::Result<Metadata> {
        self.sender.take();
        self.response().await
    }
    async fn abort(&mut self) -> opendal::Result<()> {
        self.sender.take();
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
        Ok(())
    }
}

impl Drop for StreamingWriter {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_urls_preserve_endpoint_root_and_literal_special_characters() {
        let layer = StreamingLayer::new(
            "https://example.com/dav/",
            "/configured root/",
            "user",
            "secret",
            None,
        )
        .unwrap();
        assert_eq!(
            layer.url("a #?%/file").unwrap().as_str(),
            "https://example.com/dav/configured%20root/a%20%23%3F%25/file"
        );
        let debug = format!("{layer:?}");
        assert!(!debug.contains("secret"));
        assert!(!debug.contains("user"));
        assert!(!debug.contains("example.com"));
    }

    #[test]
    fn streaming_endpoint_rejects_embedded_credentials_and_non_http_urls() {
        for endpoint in [
            "file:///tmp/file",
            "https://user:secret@example.com/",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
        ] {
            assert!(StreamingLayer::new(endpoint, "/", "", "", None).is_err());
        }
    }
}
