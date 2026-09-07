use crate::{
    error::{error, flag, recovery, remote, text, Result},
    operations::{self, BUFFER_SIZE},
    session::Session,
    uri,
};
use dbx_plugin_sdk::{PluginEmitter, PluginError};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Notify, Semaphore},
};
use tokio_util::{compat::FuturesAsyncReadCompatExt, sync::CancellationToken};
use uuid::Uuid;

const MAX_TASKS: usize = 512;
const MAX_ACTIVE_TASKS: usize = 256;
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub transfer_id: String,
    pub provider_id: String,
    pub connection_id: String,
    pub direction: String,
    pub uri: String,
    pub state: String,
    pub bytes_transferred: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<PluginError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_download_lease_id: Option<String>,
}

pub struct Task {
    snapshot: Mutex<Snapshot>,
    cancel: CancellationToken,
    created: Instant,
    last_progress: Mutex<Instant>,
    finished: Notify,
    emitter: Option<PluginEmitter>,
}

impl Task {
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.lock().unwrap().clone()
    }
    fn terminal(&self) -> bool {
        matches!(
            self.snapshot.lock().unwrap().state.as_str(),
            "completed" | "failed" | "cancelled"
        )
    }
    fn emit(&self) {
        if let Some(emitter) = &self.emitter {
            if let Ok(value) = serde_json::to_value(self.snapshot()) {
                let _ = emitter.event("filesystem/transfer/progress", value);
            }
        }
    }
    fn progress(&self, bytes: u64, total: Option<u64>) {
        {
            let mut s = self.snapshot.lock().unwrap();
            s.bytes_transferred = bytes;
            s.total_bytes = total;
        }
        let emit = {
            let mut last = self.last_progress.lock().unwrap();
            if last.elapsed() >= Duration::from_millis(250) {
                *last = Instant::now();
                true
            } else {
                false
            }
        };
        if emit {
            self.emit();
        }
    }
    fn finish(&self, result: Result<()>) {
        {
            let mut s = self.snapshot.lock().unwrap();
            match result {
                Ok(()) => s.state = "completed".into(),
                Err(e) => {
                    s.state = if e.data.as_ref().is_some_and(|d| d["code"] == "cancelled") {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .into();
                    s.error = Some(e);
                }
            }
        }
        self.emit();
        self.finished.notify_waiters();
    }
    pub async fn wait(&self) {
        loop {
            let notified = self.finished.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.terminal() {
                return;
            }
            notified.await;
        }
    }
}

pub struct Transfers {
    tasks: Mutex<HashMap<String, Arc<Task>>>,
    pub global: Arc<Semaphore>,
}

impl Default for Transfers {
    fn default() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
            global: Arc::new(Semaphore::new(8)),
        }
    }
}

impl Transfers {
    pub fn start(
        &self,
        session: Arc<Session>,
        upload: bool,
        p: &Value,
        emitter: Option<PluginEmitter>,
    ) -> Result<Value> {
        session.available()?;
        if upload {
            session.writable()?;
        }
        let path = uri::path(text(p, "uri")?, &session.protocol)?;
        uri::non_root(&path)?;
        let path = path.trim_end_matches('/').to_string();
        let local = absolute_local_path(text(p, "localPath")?)?;
        let temporary = download_temporary_directory(p, &local, upload)?;
        let overwrite = flag(p, "overwrite", false)?;
        let timeout = effective_timeout(session.operation_timeout, p)?;
        let id = Uuid::new_v4().to_string();
        let task = Arc::new(Task {
            snapshot: Mutex::new(Snapshot {
                transfer_id: id.clone(),
                provider_id: session.provider_id.clone(),
                connection_id: session.id.clone(),
                direction: if upload { "upload" } else { "download" }.into(),
                uri: uri::uri(&session.protocol, &path),
                state: "queued".into(),
                bytes_transferred: 0,
                total_bytes: None,
                error: None,
                host_download_lease_id: temporary.as_ref().map(|(id, _)| id.clone()),
            }),
            cancel: session.closed.child_token(),
            created: Instant::now(),
            last_progress: Mutex::new(Instant::now()),
            finished: Notify::new(),
            emitter,
        });
        {
            let mut tasks = self.tasks.lock().unwrap();
            tasks.retain(|_, t| !t.terminal() || t.created.elapsed() < Duration::from_secs(600));
            if tasks.values().filter(|t| !t.terminal()).count() >= MAX_ACTIVE_TASKS {
                return Err(error("rate_limited", "The transfer queue is full"));
            }
            if tasks.len() >= MAX_TASKS {
                if let Some(oldest) = tasks
                    .iter()
                    .filter(|(_, t)| t.terminal())
                    .min_by_key(|(_, t)| t.created)
                    .map(|(id, _)| id.clone())
                {
                    tasks.remove(&oldest);
                }
            }
            tasks.insert(id.clone(), task.clone());
        }
        let initial = json!(task.snapshot());
        let global = self.global.clone();
        let activity = session.activity();
        let deadline = timeout.map(|timeout| tokio::time::Instant::now() + timeout);
        tokio::spawn(async move {
            let _activity = activity;
            let control = Control {
                cancel: task.cancel.clone(),
                deadline,
            };
            let result = async {
                // Acquire the per-connection slot first so one busy connection cannot reserve every global slot.
                let _per_connection = control
                    .run(session.permits.clone().acquire_owned())
                    .await?
                    .map_err(|_| {
                        error("unavailable", "Connection transfer slots are unavailable")
                    })?;
                let _gate = control.run(session.gate.read()).await?;
                session.available()?;
                let _mutation = if upload {
                    Some(control.run(session.mutations.lock()).await?)
                } else {
                    None
                };
                // A serialized upload waiting for its mutation lock must not reserve global capacity.
                let _global = control
                    .run(global.acquire_owned())
                    .await?
                    .map_err(|_| error("unavailable", "Transfer slots are unavailable"))?;
                if upload {
                    session.writable()?;
                }
                task.snapshot.lock().unwrap().state = "running".into();
                task.emit();
                if upload {
                    upload_file(&session, &task, &control, &path, &local, overwrite).await
                } else {
                    download_file(
                        &session,
                        &task,
                        &control,
                        &path,
                        &local,
                        overwrite,
                        temporary.as_ref().map(|(_, path)| path.as_path()),
                    )
                    .await
                }
            }
            .await;
            task.finish(result);
        });
        Ok(initial)
    }

    pub fn query(&self, method: &str, p: &Value) -> Result<Value> {
        let provider = text(p, "providerId")?;
        let connection = text(p, "connectionId")?;
        let tasks = self.tasks.lock().unwrap();
        if method == "filesystem/transfer/list" {
            let mut selected: Vec<_> = tasks
                .values()
                .filter(|t| {
                    let s = t.snapshot.lock().unwrap();
                    s.provider_id == provider && s.connection_id == connection
                })
                .collect();
            selected.sort_by_key(|t| t.created);
            return Ok(
                json!({"transfers": selected.into_iter().map(|t| t.snapshot()).collect::<Vec<_>>()}),
            );
        }
        let id = text(p, "transferId")?;
        let task = tasks
            .get(id)
            .filter(|t| {
                let s = t.snapshot.lock().unwrap();
                s.provider_id == provider && s.connection_id == connection
            })
            .ok_or_else(|| error("not_found", "Transfer does not exist for this connection"))?;
        if method == "filesystem/transfer/cancel" && !task.terminal() {
            task.cancel.cancel();
        }
        Ok(json!(task.snapshot()))
    }

    pub async fn shutdown(&self) {
        let tasks: Vec<_> = self.tasks.lock().unwrap().values().cloned().collect();
        for task in &tasks {
            task.cancel.cancel();
        }
        for task in tasks {
            task.wait().await;
        }
    }
}

struct Control {
    cancel: CancellationToken,
    deadline: Option<tokio::time::Instant>,
}

impl Control {
    fn check(&self) -> Result<()> {
        if self.cancel.is_cancelled() {
            Err(error("cancelled", "Transfer cancelled"))
        } else if self
            .deadline
            .is_some_and(|deadline| tokio::time::Instant::now() >= deadline)
        {
            Err(error("timeout", "Transfer timed out"))
        } else {
            Ok(())
        }
    }
    async fn run<T>(&self, future: impl Future<Output = T>) -> Result<T> {
        self.check()?;
        let deadline = async {
            if let Some(deadline) = self.deadline {
                tokio::time::sleep_until(deadline).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(error("cancelled", "Transfer cancelled")),
            _ = deadline => Err(error("timeout", "Transfer timed out")),
            result = future => Ok(result),
        }
    }
}

pub(crate) fn effective_timeout(
    host: Option<Duration>,
    params: &Value,
) -> Result<Option<Duration>> {
    let Some(value) = params.get("timeoutMs").filter(|v| !v.is_null()) else {
        return Ok(host);
    };
    let millis = value
        .as_u64()
        .ok_or_else(|| error("configuration", "timeoutMs must be a nonnegative integer"))?;
    let requested = (millis > 0).then(|| Duration::from_millis(millis.min(86_400_000)));
    Ok(match (host, requested) {
        (Some(host), Some(requested)) => Some(host.min(requested)),
        (Some(host), None) => Some(host),
        (None, requested) => requested,
    })
}

pub fn absolute_local_path(path: &str) -> Result<PathBuf> {
    let path = Path::new(path);
    if !path.is_absolute()
        || path.file_name().is_none()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(error(
            "configuration",
            "localPath must be an absolute file path without parent traversal",
        ));
    }
    Ok(path.into())
}

async fn upload_file(
    s: &Session,
    task: &Task,
    control: &Control,
    path: &str,
    local: &Path,
    overwrite: bool,
) -> Result<()> {
    let before_open = tokio::fs::metadata(local)
        .await
        .map_err(|_| error("local_read", "Cannot inspect upload source"))?;
    if !before_open.is_file() {
        return Err(error(
            "configuration",
            "Upload source must be a regular file",
        ));
    }
    let mut source = tokio::fs::File::open(local)
        .await
        .map_err(|_| error("local_read", "Cannot open local upload source"))?;
    let metadata = source
        .metadata()
        .await
        .map_err(|_| error("local_read", "Cannot inspect upload source"))?;
    if !metadata.is_file() {
        return Err(error(
            "configuration",
            "Upload source must be a regular file",
        ));
    }
    let total = metadata.len();
    task.progress(0, Some(total));
    control
        .run(operations::destination(&s.operator, path, overwrite))
        .await??;
    let parent = path
        .rsplit_once('/')
        .map(|(p, _)| format!("{p}/"))
        .unwrap_or_default();
    // FTP stat is implemented using LIST, which can omit dotfiles even when they exist.
    let temporary = format!("{parent}dbx-upload-{}.tmp", task.snapshot().transfer_id);
    let cap = s.operator.info().full_capability();
    let mut builder = s.operator.writer_with(&temporary);
    if cap.write_can_append && (s.protocol == "ftp" || !cap.write_can_multi) {
        builder = builder.append(true);
        if !cap.write_can_multi {
            builder = builder.chunk(operations::APPEND_CHUNK_SIZE);
        }
    }
    if cap.write_with_if_not_exists {
        builder = builder.if_not_exists(true);
    }
    let mut writer = match control.run(builder.into_future()).await {
        Ok(Ok(writer)) => writer,
        result => {
            let err = match result {
                Err(e) => e,
                Ok(Err(e)) => remote(e),
                _ => unreachable!(),
            };
            return cleanup_upload(s, &temporary, Err(err), false, path).await;
        }
    };
    let mut publication_started = false;
    let result: Result<()> = async {
        let mut buffer = vec![0; BUFFER_SIZE];
        let mut bytes = 0u64;
        loop {
            control.check()?;
            // Local OS I/O is allowed to finish before cancellation so cleanup cannot race an in-flight write/open.
            let n = source
                .read(&mut buffer)
                .await
                .map_err(|_| error("local_read", "Cannot read upload source"))?;
            if n == 0 {
                break;
            }
            if bytes + n as u64 > total {
                return Err(error(
                    "source_changed",
                    "Upload source grew during transfer",
                ));
            }
            control
                .run(writer.write(buffer[..n].to_vec()))
                .await?
                .map_err(remote)?;
            bytes += n as u64;
            task.progress(bytes, Some(total));
        }
        if bytes != total {
            return Err(error(
                "source_changed",
                "Upload source changed size during transfer",
            ));
        }
        control.run(writer.close()).await?.map_err(remote)?;
        if total == 0 {
            control
                .run(operations::write_empty_file(&s.operator, &temporary))
                .await??;
        }
        control
            .run(operations::destination(&s.operator, path, overwrite))
            .await??;
        control.check()?;
        publication_started = true;
        if cap.rename {
            control
                .run(s.operator.rename(&temporary, path))
                .await?
                .map_err(remote)?;
        } else {
            control
                .run(operations::copy_file(
                    &s.operator,
                    &temporary,
                    path,
                    overwrite,
                ))
                .await??;
        }
        Ok(())
    }
    .await;
    if result.is_err() {
        if s.protocol == "ftp" {
            // FTP abort is unsupported. Finish its data stream before returning the pooled control connection.
            let _ = tokio::time::timeout(CLEANUP_TIMEOUT, writer.close()).await;
        } else {
            let _ = tokio::time::timeout(CLEANUP_TIMEOUT, writer.abort()).await;
        }
    }
    drop(writer);
    cleanup_upload(s, &temporary, result, publication_started, path).await
}

async fn cleanup_upload(
    s: &Session,
    temporary: &str,
    result: Result<()>,
    publication_started: bool,
    path: &str,
) -> Result<()> {
    let cleaned = match tokio::time::timeout(CLEANUP_TIMEOUT, s.operator.delete(temporary)).await {
        Ok(Ok(_)) => true,
        Ok(Err(e)) if e.kind() == opendal::ErrorKind::NotFound => true,
        _ => false,
    };
    if !cleaned {
        return Err(recovery(
            error(
                "cleanup_failed",
                "Remote temporary upload cleanup could not be confirmed",
            ),
            json!({"action": "remove_temporary", "temporaryPath": temporary, "targetPath": path,
                "destinationMayExist": publication_started, "cleanupSucceeded": false, "cause": result.err()}),
        ));
    }
    result.map_err(|e| {
        if publication_started {
            recovery(error("partial_transfer", "Upload publication may have completed; inspect the destination"),
                json!({"action": "inspect_destination", "targetPath": path, "destinationMayExist": true, "cleanupSucceeded": true, "cause": e}))
        } else { e }
    })
}

fn download_temporary_directory(
    p: &Value,
    local: &Path,
    upload: bool,
) -> Result<Option<(String, PathBuf)>> {
    match (
        p.get("hostDownloadLeaseId"),
        p.get("downloadTemporaryDirectory"),
    ) {
        (None, None) => Ok(None),
        (Some(id), Some(directory)) if !upload => {
            let invalid = || error("configuration", "Invalid host download temporary directory");
            let id = id.as_str().ok_or_else(invalid)?;
            Uuid::parse_str(id).map_err(|_| invalid())?;
            let directory = absolute_local_path(directory.as_str().ok_or_else(invalid)?)?;
            let metadata = std::fs::symlink_metadata(&directory).map_err(|_| invalid())?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(invalid());
            }
            let parent = local
                .parent()
                .ok_or_else(invalid)?
                .canonicalize()
                .map_err(|_| invalid())?;
            let directory = directory.canonicalize().map_err(|_| invalid())?;
            if directory.parent() != Some(parent.as_path())
                || !directory
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with(".dbx-download-lease-"))
            {
                return Err(invalid());
            }
            Ok(Some((id.into(), directory)))
        }
        _ => Err(error(
            "configuration",
            "Host download lease requires both fields on a download",
        )),
    }
}

async fn download_file(
    s: &Session,
    task: &Task,
    control: &Control,
    path: &str,
    local: &Path,
    overwrite: bool,
    temporary_directory: Option<&Path>,
) -> Result<()> {
    let metadata = control.run(operations::stat(&s.operator, path)).await??;
    if !metadata.is_file() {
        return Err(error(
            "unsupported",
            "Download source must be a regular file",
        ));
    }
    let total = metadata.content_length();
    task.progress(0, Some(total));
    match std::fs::symlink_metadata(local) {
        Ok(m) => {
            if !overwrite {
                return Err(error("already_exists", "Local destination already exists"));
            }
            if !m.is_file() || m.file_type().is_symlink() {
                return Err(error(
                    "configuration",
                    "Local destination must be a regular non-symlink file",
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(error("local_write", "Cannot inspect local destination")),
    }
    control.check()?;
    let temporary = tempfile::Builder::new()
        .prefix(".dbx-download-")
        .tempfile_in(temporary_directory.unwrap_or_else(|| local.parent().unwrap()))
        .map_err(|_| {
            error(
                "local_write",
                "Cannot create sibling download temporary file",
            )
        })?;
    let file = temporary
        .reopen()
        .map_err(|_| error("local_write", "Cannot open download temporary file"))?;
    let mut output = tokio::fs::File::from_std(file);
    let result: Result<()> = async {
        let reader = control
            .run(s.operator.reader(path))
            .await?
            .map_err(remote)?;
        let mut reader = control
            .run(reader.into_futures_async_read(..))
            .await?
            .map_err(remote)?
            .compat();
        let mut buffer = vec![0; BUFFER_SIZE];
        let mut bytes = 0u64;
        loop {
            let n = control
                .run(reader.read(&mut buffer))
                .await?
                .map_err(|_| error("transfer", "Remote download read failed"))?;
            if n == 0 {
                break;
            }
            if bytes + n as u64 > total {
                return Err(error(
                    "source_changed",
                    "Remote source grew during download",
                ));
            }
            output
                .write_all(&buffer[..n])
                .await
                .map_err(|_| error("local_write", "Cannot write download data"))?;
            bytes += n as u64;
            task.progress(bytes, Some(total));
        }
        output
            .flush()
            .await
            .map_err(|_| error("local_write", "Cannot flush download data"))?;
        output
            .sync_all()
            .await
            .map_err(|_| error("local_write", "Cannot synchronize download data"))?;
        if bytes != total {
            return Err(error(
                "source_changed",
                "Remote source changed size during download",
            ));
        }
        control.check()?;
        Ok(())
    }
    .await;
    // Flush even on failure: tokio::fs can have an outstanding blocking write after write_all returns.
    let flush = output.flush().await;
    drop(output);
    let result =
        result.and_then(|()| flush.map_err(|_| error("local_write", "Cannot flush download data")));
    if let Err(e) = result {
        let temporary_path = temporary.path().to_string_lossy().into_owned();
        if temporary.close().is_err() {
            return Err(recovery(
                error("cleanup_failed", "Download temporary cleanup failed"),
                json!({"action": "remove_temporary", "temporaryPath": temporary_path, "cleanupSucceeded": false, "cause": e}),
            ));
        }
        return Err(e);
    }
    // Publication is synchronous and uncancellable: never report cancellation after the final file became visible.
    let published = if overwrite {
        temporary.persist(local)
    } else {
        temporary.persist_noclobber(local)
    };
    match published {
        Ok(_) => Ok(()),
        Err(e) => {
            let err = if e.error.kind() == std::io::ErrorKind::AlreadyExists {
                error("already_exists", "Local destination already exists")
            } else {
                error("local_write", "Cannot publish downloaded file")
            };
            let temporary_path = e.file.path().to_string_lossy().into_owned();
            if e.file.close().is_err() {
                return Err(recovery(
                    error("cleanup_failed", "Download publication and cleanup failed"),
                    json!({"action": "remove_temporary", "temporaryPath": temporary_path, "cause": err}),
                ));
            }
            Err(err)
        }
    }
}

use std::future::IntoFuture;
