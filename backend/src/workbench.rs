use crate::{
    error::{error, flag, remote, text, Result},
    operations,
    session::Session,
    uri,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::io::AsyncReadExt;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use uuid::Uuid;

const TEXT_LIMIT: usize = 2 * 1024 * 1024;
const IMAGE_LIMIT: usize = 20 * 1024 * 1024;
const CHUNK: usize = 512 * 1024;
const TTL: Duration = Duration::from_secs(30 * 60);

struct Snapshot {
    owner: String,
    generation: u64,
    uri: String,
    bytes: Vec<u8>,
    draft: Vec<u8>,
    kind: &'static str,
    mime: &'static str,
    touched: Instant,
}
struct Local {
    owner: String,
    generation: u64,
    path: PathBuf,
    upload: bool,
    touched: Instant,
}
#[derive(Default)]
pub struct State {
    previews: Mutex<HashMap<String, Snapshot>>,
    locals: Mutex<HashMap<String, Local>>,
    dialog: tokio::sync::Mutex<()>,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

async fn bounded_read(s: &Session, path: &str, max: usize) -> Result<Vec<u8>> {
    let metadata = operations::stat(&s.operator, path).await?;
    if !metadata.is_file() {
        return Err(error("unsupported", "Only regular files can be previewed"));
    }
    if metadata.content_length() > max as u64 {
        return Err(error("too_large", "File exceeds the preview limit"));
    }
    let mut reader = s
        .operator
        .reader(path)
        .await
        .map_err(remote)?
        .into_futures_async_read(..)
        .await
        .map_err(remote)?
        .compat()
        .take(max as u64 + 1);
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| error("backend", "Could not read preview"))?;
    if bytes.len() > max {
        return Err(error("too_large", "File exceeds the preview limit"));
    }
    Ok(bytes)
}

impl State {
    pub async fn choose(&self, s: &Session, p: &Value) -> Result<Value> {
        let _dialog = self
            .dialog
            .try_lock()
            .map_err(|_| error("busy", "A file dialog is already open"))?;
        let upload = flag(p, "upload", true)?;
        if upload {
            s.writable()?;
        }
        let name = p.get("name").and_then(Value::as_str).unwrap_or("download");
        if name.contains(['/', '\\', '\0', '\n', '\r']) || name == "." || name == ".." {
            return Err(error("configuration", "Invalid local filename"));
        }
        let selected = native_dialog(upload, name.to_string()).await?;
        s.available()?;
        let Some(path) = selected else {
            return Ok(json!({"cancelled": true}));
        };
        let name = path
            .file_name()
            .ok_or_else(|| error("configuration", "Select a file"))?
            .to_string_lossy()
            .into_owned();
        let token = Uuid::new_v4().to_string();
        let mut locals = self.locals.lock().unwrap();
        locals.retain(|_, l| l.touched.elapsed() < TTL);
        if locals.len() >= 64 {
            return Err(error("rate_limited", "Too many pending file selections"));
        }
        locals.insert(
            token.clone(),
            Local {
                owner: s.id.clone(),
                generation: s.generation,
                path,
                upload,
                touched: Instant::now(),
            },
        );
        Ok(json!({"token": token, "name": name, "cancelled": false}))
    }

    pub fn local(&self, s: &Session, p: &Value) -> Result<(PathBuf, bool)> {
        let locals = self.locals.lock().unwrap();
        let l = locals
            .get(text(p, "token")?)
            .filter(|l| {
                l.owner == s.id && l.generation == s.generation && l.touched.elapsed() < TTL
            })
            .ok_or_else(|| error("expired", "File selection expired; select it again"))?;
        Ok((l.path.clone(), l.upload))
    }

    pub async fn remote(&self, s: &Session, method: &str, p: &Value) -> Result<Value> {
        if method == "preview" {
            let location = text(p, "uri")?;
            let path = uri::path(location, &s.protocol)?;
            let bytes = bounded_read(s, &path, IMAGE_LIMIT).await?;
            let (kind, mime) = if let Some(mime) = image_mime(&bytes) {
                ("image", mime)
            } else {
                if bytes.len() > TEXT_LIMIT {
                    return Err(error("too_large", "Text preview is limited to 2 MiB"));
                }
                let decoded = std::str::from_utf8(&bytes)
                    .map_err(|_| error("unsupported", "Not UTF-8 text or a supported image"))?;
                if decoded
                    .chars()
                    .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                {
                    return Err(error("unsupported", "Binary files cannot be previewed"));
                }
                ("text", "text/plain")
            };
            let token = Uuid::new_v4().to_string();
            let result = json!({"token": token, "kind": kind, "mime": mime, "size": bytes.len(), "digest": digest(&bytes)});
            let mut previews = self.previews.lock().unwrap();
            previews.retain(|_, v| v.touched.elapsed() < TTL);
            let total: usize = previews
                .values()
                .map(|v| v.bytes.len() + v.draft.len())
                .sum();
            if previews.len() >= 16 || total + bytes.len() > 64 * 1024 * 1024 {
                return Err(error(
                    "rate_limited",
                    "Close existing previews before opening another",
                ));
            }
            previews.insert(
                token,
                Snapshot {
                    owner: s.id.clone(),
                    generation: s.generation,
                    uri: location.into(),
                    bytes,
                    draft: Vec::new(),
                    kind,
                    mime,
                    touched: Instant::now(),
                },
            );
            return Ok(result);
        }
        let token = text(p, "token")?;
        // Clone only for the commit; never keep a std mutex across remote I/O.
        let commit = {
            let mut previews = self.previews.lock().unwrap();
            let v = previews
                .get_mut(token)
                .filter(|v| {
                    v.owner == s.id && v.generation == s.generation && v.touched.elapsed() < TTL
                })
                .ok_or_else(|| error("expired", "Preview expired; reopen the file"))?;
            v.touched = Instant::now();
            match method {
                "releasePreview" => {
                    previews.remove(token);
                    return Ok(json!({"success": true}));
                }
                "previewChunk" => {
                    let offset = p
                        .get("offset")
                        .and_then(Value::as_u64)
                        .filter(|n| *n <= v.bytes.len() as u64)
                        .ok_or_else(|| error("configuration", "Invalid chunk offset"))?
                        as usize;
                    let end = (offset + CHUNK).min(v.bytes.len());
                    return Ok(
                        json!({"dataBase64": STANDARD.encode(&v.bytes[offset..end]), "nextOffset": end, "mime": v.mime}),
                    );
                }
                "stageText" => {
                    s.writable()?;
                    if v.kind != "text" {
                        return Err(error("unsupported", "Images cannot be edited"));
                    }
                    let offset = p
                        .get("offset")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| error("configuration", "Invalid chunk offset"))?;
                    let encoded = p
                        .get("dataBase64")
                        .and_then(Value::as_str)
                        .ok_or_else(|| error("configuration", "Missing text chunk"))?;
                    if encoded.len() > CHUNK.div_ceil(3) * 4 {
                        return Err(error("too_large", "Text chunk exceeds limit"));
                    }
                    let bytes = STANDARD
                        .decode(encoded)
                        .map_err(|_| error("configuration", "Invalid text chunk"))?;
                    if offset == 0 {
                        v.draft.clear();
                    }
                    if offset != v.draft.len() as u64 || v.draft.len() + bytes.len() > TEXT_LIMIT {
                        return Err(error(
                            "too_large",
                            "Invalid text chunk or text exceeds 2 MiB",
                        ));
                    }
                    v.draft.extend_from_slice(&bytes);
                    return Ok(json!({"size": v.draft.len()}));
                }
                "saveText" => {
                    s.writable()?;
                    if v.kind != "text" {
                        return Err(error("unsupported", "Images cannot be edited"));
                    }
                    if p.get("size").and_then(Value::as_u64) != Some(v.draft.len() as u64)
                        || p.get("digest").and_then(Value::as_str)
                            != Some(digest(&v.draft).as_str())
                    {
                        return Err(error("configuration", "Incomplete text upload"));
                    }
                    std::str::from_utf8(&v.draft)
                        .map_err(|_| error("configuration", "Text must be UTF-8"))?;
                    (v.uri.clone(), v.bytes.clone(), v.draft.clone())
                }
                _ => return Err(error("unsupported", "Unknown preview operation")),
            }
        };
        let _mutation = s.mutations.lock().await;
        let path = uri::path(&commit.0, &s.protocol)?;
        let force = flag(p, "force", false)?;
        let before = operations::stat(&s.operator, &path).await?;
        if !before.is_file() {
            return Err(error("unsupported", "Only regular files can be edited"));
        }
        if !force && bounded_read(s, &path, TEXT_LIMIT).await? != commit.1 {
            return Err(error(
                "conflict",
                "Remote file changed; reload or explicitly overwrite",
            ));
        }
        let cap = s.operator.info().full_capability();
        let mut write = s.operator.write_with(&path, commit.2.clone());
        if !force && cap.write_with_if_match {
            if let Some(etag) = before.etag() {
                write = write.if_match(etag);
            }
        }
        write.await.map_err(|e| {
            if e.kind() == opendal::ErrorKind::ConditionNotMatch {
                error("conflict", "Remote file changed")
            } else {
                remote(e)
            }
        })?;
        if commit.2.is_empty() && s.protocol == "ftp" {
            operations::write_empty_file(&s.operator, &path).await?;
        }
        let hash = digest(&commit.2);
        if let Some(v) = self.previews.lock().unwrap().get_mut(token) {
            v.bytes = commit.2;
            v.draft.clear();
        }
        Ok(
            json!({"digest": hash, "success": true, "atomic": cap.write_with_if_match && before.etag().is_some()}),
        )
    }
}

#[cfg(target_os = "macos")]
async fn native_dialog(upload: bool, name: String) -> Result<Option<PathBuf>> {
    let script = if upload {
        "on run argv\ntry\nreturn POSIX path of (choose file with prompt \"选择上传文件\")\non error number -128\nreturn \"\"\nend try\nend run"
    } else {
        "on run argv\ntry\nreturn POSIX path of (choose file name with prompt \"保存下载文件\" default name (item 1 of argv))\non error number -128\nreturn \"\"\nend try\nend run"
    };
    let output = tokio::time::timeout(
        Duration::from_secs(290),
        tokio::process::Command::new("/usr/bin/osascript")
            .args(["-e", script, &name])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| error("timeout", "File selection timed out"))?
    .map_err(|_| error("local_dialog", "Cannot open the native file dialog"))?;
    if !output.status.success() {
        return Err(error("local_dialog", "Native file dialog failed"));
    }
    let path = String::from_utf8(output.stdout)
        .map_err(|_| error("local_dialog", "Invalid local path"))?;
    let path = path.strip_suffix('\n').unwrap_or(&path);
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(PathBuf::from(path)))
    }
}

#[cfg(not(target_os = "macos"))]
async fn native_dialog(_: bool, _: String) -> Result<Option<PathBuf>> {
    Err(error(
        "unsupported",
        "Native dialogs are available on macOS only",
    ))
}
