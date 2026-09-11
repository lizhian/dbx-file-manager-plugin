use crate::error::{error, Result};
use opendal::OperationContext;
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
pub struct StreamingAccess {
    inner: Servicer,
    config: StreamingLayer,
}
impl Layer for StreamingLayer {
    fn apply_service(&self, inner: Servicer) -> Servicer {
        Arc::new(StreamingAccess {
            inner,
            config: self.clone(),
        })
    }
}
impl Service for StreamingAccess {
    type Reader = oio::Reader;
    type Writer = StreamingWriter;
    type Lister = oio::Lister;
    type Deleter = oio::Deleter;
    type Copier = oio::Copier;
    type Composer = ();
    fn info(&self) -> ServiceInfo {
        self.inner.info()
    }
    fn capability(&self) -> opendal::Capability {
        let mut c = self.inner.capability();
        c.write_can_multi = true;
        c
    }
    async fn create_dir(
        &self,
        ctx: &OperationContext,
        path: &str,
        args: OpCreateDir,
    ) -> opendal::Result<RpCreateDir> {
        self.inner.create_dir(ctx, path, args).await
    }
    async fn stat(
        &self,
        ctx: &OperationContext,
        path: &str,
        args: OpStat,
    ) -> opendal::Result<RpStat> {
        self.inner.stat(ctx, path, args).await
    }
    fn read(
        &self,
        ctx: &OperationContext,
        path: &str,
        args: OpRead,
    ) -> opendal::Result<Self::Reader> {
        self.inner.read(ctx, path, args)
    }
    fn list(
        &self,
        ctx: &OperationContext,
        path: &str,
        args: OpList,
    ) -> opendal::Result<Self::Lister> {
        self.inner.list(ctx, path, args)
    }
    fn delete(&self, ctx: &OperationContext) -> opendal::Result<Self::Deleter> {
        self.inner.delete(ctx)
    }
    fn copy(
        &self,
        ctx: &OperationContext,
        from: &str,
        to: &str,
        args: OpCopy,
    ) -> opendal::Result<Self::Copier> {
        self.inner.copy(ctx, from, to, args)
    }
    async fn rename(
        &self,
        ctx: &OperationContext,
        from: &str,
        to: &str,
        args: OpRename,
    ) -> opendal::Result<RpRename> {
        self.inner.rename(ctx, from, to, args).await
    }
    async fn presign(
        &self,
        ctx: &OperationContext,
        path: &str,
        args: OpPresign,
    ) -> opendal::Result<RpPresign> {
        self.inner.presign(ctx, path, args).await
    }
    fn write(
        &self,
        _ctx: &OperationContext,
        path: &str,
        args: OpWrite,
    ) -> opendal::Result<Self::Writer> {
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
                return Ok(opendal::MetadataBuilder::unknown().build());
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
        Ok(StreamingWriter {
            written: 0,
            sender: Some(sender),
            task: Some(task),
        })
    }
}

pub struct StreamingWriter {
    written: u64,
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
        self.written += buffer.len() as u64;
        Ok(())
    }
    async fn close(&mut self) -> opendal::Result<Metadata> {
        self.sender.take();
        self.response().await?;
        Ok(opendal::MetadataBuilder::file(self.written).build())
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
