use crate::{
    error::{error, flag, number, recovery, remote, text, Result},
    session::{Cursor, Session},
    uri,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::TryStreamExt;
use opendal::{Metadata, Operator};
use serde_json::{json, Value};
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use uuid::Uuid;

pub const BUFFER_SIZE: usize = 64 * 1024;
// Append-only stores can require a round trip per write; aggregate without buffering the whole file.
pub const APPEND_CHUNK_SIZE: usize = 4 * 1024 * 1024;
pub const INLINE_LIMIT: u64 = 4 * 1024 * 1024;

pub async fn file_metadata(op: &Operator, path: &str) -> Result<Option<Metadata>> {
    if !op.info().full_capability().stat {
        uri::non_root(path)?;
        if path.ends_with('/') {
            return Err(error("unsupported", "A file path is required"));
        }
        return Ok(None);
    }
    let metadata = stat(op, path).await?;
    if !metadata.is_file() {
        return Err(error("unsupported", "Only regular files can be read"));
    }
    Ok(Some(metadata))
}

// Unlike the seekable adapter, this stream does not issue a hidden stat request.
pub async fn reader(op: &Operator, path: &str) -> Result<impl tokio::io::AsyncRead + Unpin> {
    Ok(op
        .reader(path)
        .await
        .map_err(remote)?
        .into_bytes_stream(..)
        .await
        .map_err(remote)?
        .into_async_read()
        .compat())
}

pub fn entry(s: &Session, path: &str, m: &Metadata) -> Value {
    let mut result = json!({"name": path.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("/"),
        "uri": s.uri(path),
        "kind": if m.is_dir() { "directory" } else if m.is_file() { "file" } else { "other" }});
    if m.is_file() {
        result["size"] = json!(m.content_length());
    }
    if let Some(t) = m.last_modified() {
        result["modifiedAt"] = json!(t.to_string());
    }
    if let Some(t) = m.content_type() {
        result["contentType"] = json!(t);
    }
    result
}

pub async fn stat(op: &Operator, path: &str) -> Result<Metadata> {
    match op.stat(if path.is_empty() { "/" } else { path }).await {
        Ok(m) => Ok(m),
        Err(e)
            if matches!(
                e.kind(),
                opendal::ErrorKind::NotFound | opendal::ErrorKind::Unexpected
            ) && !path.ends_with('/') =>
        {
            // WebDAV servers can return a redirect error for a directory without its trailing slash.
            match op.stat(&format!("{path}/")).await {
                Ok(metadata) => Ok(metadata),
                Err(_) => Err(remote(e)),
            }
        }
        Err(e) => Err(remote(e)),
    }
}

pub async fn exists(op: &Operator, path: &str) -> Result<bool> {
    match stat(op, path).await {
        Ok(_) => return Ok(true),
        Err(e) if e.data.as_ref().is_some_and(|d| d["code"] == "not_found") => {}
        Err(e) => return Err(e),
    }
    if op.info().full_capability().list {
        let dir = format!("{}/", path.trim_end_matches('/'));
        let mut lister = match op.lister_with(&dir).limit(1).await {
            Ok(lister) => lister,
            Err(e) if e.kind() == opendal::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(remote(e)),
        };
        return match lister.try_next().await {
            Ok(entry) => Ok(entry.is_some()),
            Err(e) if e.kind() == opendal::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(remote(e)),
        };
    }
    Ok(false)
}

pub async fn destination(op: &Operator, path: &str, overwrite: bool) -> Result<()> {
    if exists(op, path).await? {
        if !overwrite {
            return Err(error("already_exists", "The destination already exists"));
        }
        if stat(op, path).await?.is_dir() {
            return Err(error(
                "unsupported",
                "A destination directory cannot be replaced",
            ));
        }
    }
    Ok(())
}

pub async fn dispatch(s: &Session, method: &str, p: &Value) -> Result<Value> {
    if method == "filesystem/capabilities" {
        return Ok(s.capabilities());
    }
    let capability = match method {
        "filesystem/createDirectory" => "mkdir",
        other => other.strip_prefix("filesystem/").unwrap_or(other),
    };
    s.require(capability)?;
    let mutating = matches!(
        method,
        "filesystem/write"
            | "filesystem/createDirectory"
            | "filesystem/delete"
            | "filesystem/copy"
            | "filesystem/rename"
    );
    let _mutation = if mutating {
        s.writable()?;
        Some(s.mutations.lock().await)
    } else {
        None
    };
    if matches!(method, "filesystem/copy" | "filesystem/rename") {
        return move_or_copy(s, method, p).await;
    }
    let path = s.path(text(p, "uri")?)?;
    let op = &s.operator();
    match method {
        "filesystem/stat" => {
            let m = stat(op, &path).await?;
            let mut result = entry(s, &path, &m);
            if let Some(etag) = m.etag() {
                result["etag"] = json!(etag);
            }
            Ok(result)
        }
        "filesystem/list" => list(s, &path, p).await,
        "filesystem/read" => {
            let max = number(p, "maxBytes", 256 * 1024, INLINE_LIMIT)?;
            let m = file_metadata(op, &path).await?;
            let mut reader = reader(op, &path).await?.take(max + 1);
            let mut bytes = Vec::new();
            reader
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| error("backend", "Could not read the remote file"))?;
            let truncated = bytes.len() as u64 > max;
            bytes.truncate(max as usize);
            Ok(
                json!({"dataBase64": STANDARD.encode(bytes), "truncated": truncated, "contentType": m.as_ref().and_then(|m| m.content_type()), "etag": m.as_ref().and_then(|m| m.etag())}),
            )
        }
        "filesystem/write" => {
            let path = uri::non_root(&path)?;
            let encoded = p
                .get("dataBase64")
                .and_then(Value::as_str)
                .ok_or_else(|| error("configuration", "dataBase64 is required"))?;
            if encoded.len() > (INLINE_LIMIT as usize).div_ceil(3) * 4 {
                return Err(error("configuration", "Inline write exceeds 4 MiB"));
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| error("configuration", "Invalid base64"))?;
            if bytes.len() as u64 > INLINE_LIMIT {
                return Err(error("configuration", "Inline write exceeds 4 MiB"));
            }
            let create = flag(p, "create", true)?;
            let overwrite = flag(p, "overwrite", false)?;
            let present = exists(op, path).await?;
            if !present && !create {
                return Err(error(
                    "not_found",
                    "Creation is disabled and the file does not exist",
                ));
            }
            destination(op, path, overwrite).await?;
            let cap = op.info().full_capability();
            let needs_empty_write =
                bytes.is_empty() && cap.write_can_append && !cap.write_can_multi;
            let mut write = op.write_with(path, bytes);
            if let Some(etag) = p.get("etag").filter(|v| !v.is_null()) {
                let etag = etag
                    .as_str()
                    .ok_or_else(|| error("configuration", "etag must be a string"))?;
                if !cap.write_with_if_match {
                    return Err(error(
                        "unsupported",
                        "Conditional ETag writes are unavailable",
                    ));
                }
                write = write.if_match(etag);
            }
            if !overwrite && cap.write_with_if_not_exists {
                write = write.if_not_exists(true);
            }
            write.await.map_err(remote)?;
            if needs_empty_write {
                write_empty_file(op, path).await?;
            }
            Ok(json!({"success": true}))
        }
        "filesystem/createDirectory" => {
            let path = uri::non_root(&path)?;
            destination(op, path, false).await?;
            op.create_dir(&format!("{path}/")).await.map_err(remote)?;
            Ok(json!({"success": true}))
        }
        "filesystem/delete" => {
            if flag(p, "recursive", false)? {
                return Err(error("unsupported", "Recursive delete is not supported"));
            }
            let path = uri::non_root(&path)?;
            let m = stat(op, path).await?;
            let path = if m.is_dir() {
                let dir = format!("{path}/");
                let mut lister = op.lister_with(&dir).limit(2).await.map_err(remote)?;
                for _ in 0..2 {
                    if let Some(child) = lister.try_next().await.map_err(remote)? {
                        if child.path() != dir {
                            return Err(error(
                                "directory_not_empty",
                                "Only empty directories can be deleted",
                            ));
                        }
                    } else {
                        break;
                    }
                }
                dir
            } else if m.is_file() {
                path.into()
            } else {
                return Err(error("unsupported", "Unsupported entry type"));
            };
            op.delete(&path).await.map_err(remote)?;
            Ok(json!({"success": true}))
        }
        _ => Err(error("unsupported", "Unknown filesystem operation")),
    }
}

async fn list(s: &Session, path: &str, p: &Value) -> Result<Value> {
    let limit = number(p, "limit", 200, 1000)? as usize;
    let dir = if path.is_empty() {
        "/".into()
    } else {
        format!("{}/", path.trim_end_matches('/'))
    };
    let token = p.get("cursor").filter(|v| !v.is_null());
    let (mut lister, mut pending) = if let Some(token) = token {
        let token = token
            .as_str()
            .ok_or_else(|| error("configuration", "Invalid cursor"))?;
        let mut cursors = s.cursors.lock().unwrap();
        Session::prune_cursors(&mut cursors);
        if !cursors.get(token).is_some_and(|c| c.path == dir) {
            return Err(error(
                "invalid_cursor",
                "Cursor is expired or belongs to another directory",
            ));
        }
        let cursor = cursors.remove(token).unwrap();
        (cursor.lister, cursor.pending)
    } else {
        if !stat(&s.operator(), path).await?.is_dir() {
            return Err(error("configuration", "Listing requires a directory"));
        }
        (
            s.operator()
                .lister_with(&dir)
                // MinIO can report IsTruncated=false when max-keys=1 returns only the directory marker.
                .limit(limit.max(2))
                .await
                .map_err(remote)?,
            None,
        )
    };
    let mut entries = Vec::with_capacity(limit);
    let mut exhausted = false;
    let mut response_bytes = 0;
    // At most limit+1 pulls, even if a backend returns its own directory entry.
    for _ in 0..=limit {
        let next = if let Some(value) = pending.take() {
            Some(value)
        } else {
            match lister.try_next().await.map_err(remote)? {
                None => {
                    exhausted = true;
                    break;
                }
                Some(e) if e.path().trim_matches('/') == dir.trim_matches('/') => continue,
                Some(e) => {
                    let generated = s.uri(e.path());
                    let checked = s.path(&generated)?;
                    if !path.is_empty() && !checked.starts_with(&dir) {
                        return Err(error(
                            "backend",
                            "Backend returned an entry outside the requested directory",
                        ));
                    }
                    Some(entry(s, &checked, e.metadata()))
                }
            }
        };
        if let Some(value) = next {
            let size = serde_json::to_vec(&value)
                .map_err(|_| error("backend", "Cannot encode listing entry"))?
                .len();
            if response_bytes + size > 6 * 1024 * 1024 {
                pending = Some(value);
                break;
            }
            response_bytes += size;
            entries.push(value);
            if entries.len() == limit {
                break;
            }
        }
    }
    let next_cursor = if exhausted {
        None
    } else {
        let mut cursors = s.cursors.lock().unwrap();
        Session::prune_cursors(&mut cursors);
        if cursors.len() >= 64 {
            return Err(error("rate_limited", "Too many active listing cursors"));
        }
        let token = Uuid::new_v4().to_string();
        cursors.insert(
            token.clone(),
            Cursor {
                path: dir,
                lister,
                touched: Instant::now(),
                pending,
            },
        );
        Some(token)
    };
    Ok(json!({"entries": entries, "nextCursor": next_cursor}))
}

pub async fn copy_file(op: &Operator, source: &str, target: &str, overwrite: bool) -> Result<()> {
    if !stat(op, source).await?.is_file() {
        return Err(error("unsupported", "Recursive copy is not supported"));
    }
    destination(op, target, overwrite).await?;
    let cap = op.info().full_capability();
    if cap.copy {
        let mut copy = op.copy_with(source, target);
        if !overwrite && cap.copy_with_if_not_exists {
            copy = copy.if_not_exists(true);
        }
        copy.await.map_err(remote)?;
    } else {
        let mut reader = op
            .reader(source)
            .await
            .map_err(remote)?
            .into_futures_async_read(..)
            .await
            .map_err(remote)?
            .compat();
        let mut builder = op.writer_with(target);
        if !cap.write_can_multi && cap.write_can_append {
            write_empty_file(op, target).await?;
            builder = builder.append(true).chunk(APPEND_CHUNK_SIZE);
        }
        if !overwrite && cap.write_with_if_not_exists {
            builder = builder.if_not_exists(true);
        }
        let mut writer = builder.await.map_err(remote)?;
        let mut buffer = vec![0; BUFFER_SIZE];
        let mut empty = true;
        let copied: Result<()> = async {
            loop {
                let n = reader
                    .read(&mut buffer)
                    .await
                    .map_err(|_| error("transfer", "Remote copy read failed"))?;
                if n == 0 {
                    break;
                }
                empty = false;
                writer.write(buffer[..n].to_vec()).await.map_err(remote)?;
            }
            writer.close().await.map_err(remote)?;
            Ok(())
        }
        .await;
        if copied.is_err() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), writer.abort()).await;
        }
        copied?;
        if empty {
            write_empty_file(op, target).await?;
        }
    }
    Ok(())
}

pub async fn write_empty_file(op: &Operator, path: &str) -> Result<()> {
    use opendal::raw::{oio::Write, Access, OpWrite};
    // High-level Writer::write skips empty buffers; FTP needs a real zero-byte data stream to create the file.
    let (_, mut writer) = op
        .inner()
        .write(path, OpWrite::default())
        .await
        .map_err(remote)?;
    writer.write(opendal::Buffer::new()).await.map_err(remote)?;
    writer.close().await.map_err(remote)?;
    Ok(())
}

async fn move_or_copy(s: &Session, method: &str, p: &Value) -> Result<Value> {
    for key in ["targetConnectionId", "sourceConnectionId"] {
        if p.get(key)
            .is_some_and(|v| v != &Value::String(s.id.clone()))
        {
            return Err(error(
                "unsupported",
                "Cross-connection copy and rename are not supported",
            ));
        }
    }
    if flag(p, "recursive", false)? {
        return Err(error("unsupported", "Recursive copy is not supported"));
    }
    let source = s.path(text(p, "sourceUri")?)?;
    let target = s.path(text(p, "targetUri")?)?;
    let source = uri::non_root(&source)?;
    let target = uri::non_root(&target)?;
    if source == target || target.starts_with(&format!("{source}/")) {
        return Err(error("configuration", "Source and destination overlap"));
    }
    let overwrite = flag(p, "overwrite", false)?;
    let op = &s.operator();
    let is_dir = stat(op, source).await?.is_dir();
    if method == "filesystem/copy" {
        copy_file(op, source, target, overwrite).await?;
    } else if is_dir {
        destination(op, target, false).await?;
        rename_directory(op, source, target).await?;
    } else if op.info().full_capability().rename {
        destination(op, target, overwrite).await?;
        op.rename(source, target).await.map_err(remote)?;
    } else {
        copy_file(op, source, target, overwrite).await?;
        op.delete(source)
            .await
            .map_err(|_| partial_rename(source, target))?;
    }
    Ok(json!({"success": true}))
}

pub fn partial_rename(source: &str, target: &str) -> dbx_plugin_sdk::PluginError {
    recovery(
        error(
            "partial_rename",
            "Rename may be partially complete; inspect both locations before retrying",
        ),
        json!({"sourcePath": source, "targetPath": target, "action": "inspect_both_locations", "destinationMayExist": true, "sourceMayExist": true}),
    )
}

async fn rename_directory(op: &Operator, source: &str, target: &str) -> Result<()> {
    let from = format!("{source}/");
    let to = format!("{target}/");
    // Preserve the original copy-then-delete directory move, never erase source before every copy succeeds.
    let moved: Result<()> = async {
        op.create_dir(&to).await.map_err(remote)?;
        let mut lister = op
            .lister_with(&from)
            .recursive(true)
            .limit(1000)
            .await
            .map_err(remote)?;
        while let Some(e) = lister.try_next().await.map_err(remote)? {
            if e.path() == from {
                continue;
            }
            let relative = e
                .path()
                .strip_prefix(&from)
                .ok_or_else(|| partial_rename(source, target))?;
            // Reject adversarial backend paths before they reach a mutation API.
            uri::path(&uri::uri("check", relative), "check")?;
            let dest = format!("{to}{relative}");
            if e.metadata().is_dir() {
                op.create_dir(&dest).await.map_err(remote)?;
            } else if e.metadata().is_file() {
                copy_file(op, e.path(), &dest, false).await?;
            } else {
                return Err(partial_rename(source, target));
            }
        }
        op.delete_with(&from)
            .recursive(true)
            .await
            .map_err(remote)?;
        Ok(())
    }
    .await;
    moved.map_err(|_| partial_rename(source, target))
}
