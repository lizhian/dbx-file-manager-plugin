mod config;
mod error;
mod operations;
mod session;
mod transfer;
mod uri;
mod webdav;
mod workbench;

use config::ConnectionRequest;
pub use config::PLUGIN_ID;
use dbx_plugin_sdk::{PluginEmitter, PluginError, PluginHandler, RequestContext};
use error::{error, recovery, remote, text, Result};
use serde_json::{json, Value};
use session::{Activity, Session};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::runtime::Runtime;

pub struct Plugin {
    runtime: Runtime,
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
    descriptors: Mutex<HashMap<String, Arc<ConnectionRequest>>>,
    lifecycle: Arc<tokio::sync::Mutex<()>>,
    transfers: transfer::Transfers,
    workbench: workbench::State,
    stopping: AtomicBool,
    generation: AtomicU64,
    maintenance_stop: tokio_util::sync::CancellationToken,
    maintenance: Mutex<Option<tokio::task::JoinHandle<()>>>,
    #[cfg(test)]
    operator_factory: Mutex<Option<OperatorFactory>>,
}

#[cfg(test)]
type OperatorFactory = Arc<dyn Fn(&ConnectionRequest) -> Result<opendal::Operator> + Send + Sync>;

impl Plugin {
    pub fn new() -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()?;
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let lifecycle = Arc::new(tokio::sync::Mutex::new(()));
        let maintenance_stop = tokio_util::sync::CancellationToken::new();
        let task = {
            let sessions = sessions.clone();
            let lifecycle = lifecycle.clone();
            let stop = maintenance_stop.clone();
            runtime.spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));
                loop {
                    tokio::select! {
                        biased;
                        _ = stop.cancelled() => break,
                        _ = interval.tick() => {
                            if let Ok(_lifecycle) = lifecycle.try_lock() { evict_idle(&sessions); }
                        }
                    }
                }
            })
        };
        Ok(Self {
            runtime,
            sessions,
            descriptors: Mutex::new(HashMap::new()),
            lifecycle,
            transfers: transfer::Transfers::default(),
            workbench: workbench::State::default(),
            stopping: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            maintenance_stop,
            maintenance: Mutex::new(Some(task)),
            #[cfg(test)]
            operator_factory: Mutex::new(None),
        })
    }

    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.maintenance_stop.cancel();
        let maintenance = self.maintenance.lock().unwrap().take();
        self.runtime.block_on(async {
            if let Some(maintenance) = maintenance {
                let _ = maintenance.await;
            }
            let _lifecycle = self.lifecycle.lock().await;
            self.descriptors.lock().unwrap().clear();
            let sessions: Vec<_> = self
                .sessions
                .lock()
                .unwrap()
                .drain()
                .map(|(_, s)| s)
                .collect();
            for s in &sessions {
                s.closed.cancel();
            }
            self.transfers.shutdown().await;
            for s in sessions {
                s.wait_drained().await;
                let _gate = s.gate.write().await;
            }
        });
    }

    fn cached_session(&self, id: &str, provider: &str) -> Result<Option<(Arc<Session>, Activity)>> {
        let sessions = self.sessions.lock().unwrap();
        let Some(s) = sessions.get(id) else {
            return Ok(None);
        };
        if s.provider_id != provider {
            return Err(error(
                "configuration",
                "Filesystem provider does not match this connection",
            ));
        }
        if s.closed.is_cancelled() || s.idle() {
            return Ok(None);
        }
        Ok(Some((s.clone(), s.activity())))
    }

    async fn session(&self, p: &Value) -> Result<(Arc<Session>, Activity)> {
        let id = text(p, "connectionId")?;
        let provider = text(p, "providerId")?;
        if let Some(cached) = self.cached_session(id, provider)? {
            return Ok(cached);
        }
        let _lifecycle = self.lifecycle.lock().await;
        if self.stopping.load(Ordering::SeqCst) {
            return Err(error("unavailable", "Sidecar is shutting down"));
        }
        if let Some(cached) = self.cached_session(id, provider)? {
            return Ok(cached);
        }
        let request = self
            .descriptors
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("not_connected", "Connection is not connected"))?;
        if format!("{}.files", request.provider.id) != provider {
            return Err(error(
                "configuration",
                "Filesystem provider does not match this connection",
            ));
        }
        self.retire(id).await;
        let session = self.build_session(&request).await?;
        let mut sessions = self.sessions.lock().unwrap();
        let activity = session.activity();
        sessions.insert(id.into(), session.clone());
        Ok((session, activity))
    }

    async fn retire(&self, id: &str) {
        let session = self.sessions.lock().unwrap().remove(id);
        if let Some(s) = session {
            s.closed.cancel();
            s.wait_drained().await;
            let _gate = s.gate.write().await;
            s.cursors.lock().unwrap().clear();
        }
    }

    async fn build_session(&self, request: &ConnectionRequest) -> Result<Arc<Session>> {
        #[cfg(test)]
        let op = match self.operator_factory.lock().unwrap().as_ref().cloned() {
            Some(factory) => factory(request)?,
            None => request.build()?,
        };
        #[cfg(not(test))]
        let op = request.build()?;
        let timeout = request
            .connection
            .extra
            .get("connect_timeout_secs")
            .and_then(Value::as_u64)
            .filter(|v| *v > 0)
            .unwrap_or(30)
            .clamp(1, 300);
        tokio::time::timeout(Duration::from_secs(timeout), op.check())
            .await
            .map_err(|_| error("timeout", "Connection check timed out"))?
            .map_err(remote)?;
        let mut session = Session::new(
            request.connection.id.clone(),
            request.protocol()?.into(),
            op,
            request.connection.read_only,
        );
        session.fingerprint = request.fingerprint;
        session.operation_timeout = request.query_timeout()?;
        session.idle_timeout = request.idle_timeout()?;
        session.generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(Arc::new(session))
    }

    pub fn invoke(
        &self,
        method: &str,
        params: Value,
        emitter: Option<PluginEmitter>,
    ) -> Result<Value> {
        if let Some(method) = method.strip_prefix("workbench/") {
            let result = self
                .runtime
                .block_on(self.workbench_call(method, params, emitter));
            return Ok(match result {
                Ok(value) => json!({"ok": true, "value": value}),
                Err(e) => json!({"ok": false, "error": {"message": e.message, "details": e.data}}),
            });
        }
        self.runtime
            .block_on(self.dispatch(method, params, emitter))
    }

    async fn workbench_call(
        &self,
        method: &str,
        params: Value,
        emitter: Option<PluginEmitter>,
    ) -> Result<Value> {
        let (s, _activity) = self.session(&params).await?;
        if self.stopping.load(Ordering::SeqCst) {
            return Err(error("unavailable", "Sidecar is shutting down"));
        }
        if method == "chooseLocal" {
            return tokio::select! {
                _ = s.closed.cancelled() => Err(error("not_connected", "Connection closed")),
                result = self.workbench.choose(&s, &params) => result,
            };
        }
        if method == "startTransfer" {
            let mut p = params.clone();
            let (path, upload) = self.workbench.local(&s, &p)?;
            p["localPath"] = json!(path);
            // The path is selected by a native dialog, never supplied by iframe JavaScript.
            if upload {
                let path = uri::path(text(&p, "uri")?, &s.protocol)?;
                operations::destination(&s.operator, &path, error::flag(&p, "overwrite", false)?)
                    .await?;
            }
            return self.transfers.start(s, upload, &p, emitter);
        }
        if matches!(
            method,
            "preview" | "previewChunk" | "stageText" | "saveText" | "releasePreview"
        ) {
            let operation = async {
                let _gate = s.gate.read().await;
                s.available()?;
                let _connection = s
                    .permits
                    .acquire()
                    .await
                    .map_err(|_| error("unavailable", "Connection unavailable"))?;
                let _global = self
                    .transfers
                    .global
                    .acquire()
                    .await
                    .map_err(|_| error("unavailable", "Operation unavailable"))?;
                self.workbench.remote(&s, method, &params).await
            };
            let timeout = s.operation_timeout.unwrap_or(Duration::from_secs(120));
            return tokio::select! {
                _ = s.closed.cancelled() => Err(error("not_connected", "Connection closed")),
                result = tokio::time::timeout(timeout, operation) => result.map_err(|_| error("timeout", "Remote operation timed out; inspect the file before retrying"))?,
            };
        }
        match method {
            "capabilities" | "list" | "stat" | "createDirectory" | "delete" | "rename" => {
                self.dispatch(&format!("filesystem/{method}"), params, emitter)
                    .await
            }
            "transfer/list" | "transfer/status" | "transfer/cancel" => {
                self.dispatch(&format!("filesystem/{method}"), params, emitter)
                    .await
            }
            _ => Err(error("unsupported", "Unknown workbench operation")),
        }
    }

    async fn dispatch(
        &self,
        method: &str,
        params: Value,
        emitter: Option<PluginEmitter>,
    ) -> Result<Value> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err(error("unavailable", "Sidecar is shutting down"));
        }
        match method {
            "connection/test" | "connection/connect" | "connection/disconnect" => {
                self.connection(method, params).await
            }
            "filesystem/transfer/status"
            | "filesystem/transfer/list"
            | "filesystem/transfer/cancel" => self.transfers.query(method, &params),
            "filesystem/transfer/startUpload" | "filesystem/transfer/startDownload" => {
                let (s, _activity) = self.session(&params).await?;
                self.transfers
                    .start(s, method.ends_with("startUpload"), &params, emitter)
            }
            "filesystem/capabilities"
            | "filesystem/stat"
            | "filesystem/list"
            | "filesystem/read"
            | "filesystem/write"
            | "filesystem/createDirectory"
            | "filesystem/delete"
            | "filesystem/rename"
            | "filesystem/copy" => {
                let (s, _activity) = self.session(&params).await?;
                let mutation = matches!(
                    method,
                    "filesystem/write"
                        | "filesystem/createDirectory"
                        | "filesystem/delete"
                        | "filesystem/rename"
                        | "filesystem/copy"
                );
                if mutation {
                    s.writable()?;
                }
                let operation = async {
                    let _gate = s.gate.read().await;
                    s.available()?;
                    let _connection = s
                        .permits
                        .acquire()
                        .await
                        .map_err(|_| error("unavailable", "Connection slots unavailable"))?;
                    let _global = self
                        .transfers
                        .global
                        .acquire()
                        .await
                        .map_err(|_| error("unavailable", "Operation slots unavailable"))?;
                    operations::dispatch(&s, method, &params).await
                };
                let deadline = async {
                    if let Some(timeout) = s.operation_timeout {
                        tokio::time::sleep(timeout).await;
                    } else {
                        std::future::pending::<()>().await;
                    }
                };
                let result = tokio::select! {
                    biased;
                    _ = s.closed.cancelled() => Err(error("not_connected", "Connection generation was closed")),
                    _ = deadline => Err(error("timeout", "Remote operation timed out")),
                    result = operation => result,
                };
                result.map_err(|e| {
                    if mutation && e.data.as_ref().is_some_and(|d| d["code"] == "timeout" || d["code"] == "not_connected") {
                        recovery(e, json!({"action": "inspect_both_locations", "sourceUri": params.get("sourceUri"),
                            "targetUri": params.get("targetUri").or(params.get("uri")), "destinationMayExist": true, "sourceMayExist": true}))
                    } else { e }
                })
            }
            _ => {
                let mut e = PluginError::method_not_found(method);
                e.data = Some(json!({"code": "method_not_found"}));
                Err(e)
            }
        }
    }

    async fn connection(&self, method: &str, params: Value) -> Result<Value> {
        let request = ConnectionRequest::parse(params)?;
        let protocol = request.protocol()?.to_string();
        let id = &request.connection.id;
        let _lifecycle = self.lifecycle.lock().await;
        if self.stopping.load(Ordering::SeqCst) {
            return Err(error("unavailable", "Sidecar is shutting down"));
        }
        if method == "connection/disconnect" {
            if self
                .descriptors
                .lock()
                .unwrap()
                .get(id)
                .is_some_and(|r| r.provider.id != request.provider.id)
                || self
                    .sessions
                    .lock()
                    .unwrap()
                    .get(id)
                    .is_some_and(|s| s.protocol != protocol)
            {
                return Err(error("configuration", "Connection provider mismatch"));
            }
            self.descriptors.lock().unwrap().remove(id);
            self.retire(id).await;
            return Ok(json!({"success": true}));
        }
        if method == "connection/connect" {
            let current = self.sessions.lock().unwrap().get(id).cloned();
            if let Some(s) = current {
                if s.fingerprint == request.fingerprint && !s.closed.is_cancelled() && !s.idle() {
                    *s.last_used.lock().unwrap() = std::time::Instant::now();
                    return Ok(connection_result(&protocol));
                }
            }
            let full = {
                let descriptors = self.descriptors.lock().unwrap();
                descriptors.len() >= 128 && !descriptors.contains_key(id)
            };
            if full {
                return Err(error("rate_limited", "Too many open connections"));
            }
            self.descriptors.lock().unwrap().remove(id);
            self.retire(id).await;
        }
        let session = self.build_session(&request).await?;
        if method == "connection/connect" {
            let id = id.clone();
            self.descriptors
                .lock()
                .unwrap()
                .insert(id.clone(), Arc::new(request));
            self.sessions.lock().unwrap().insert(id, session);
        }
        Ok(connection_result(&protocol))
    }
}

fn connection_result(protocol: &str) -> Value {
    let mut result = json!({"success": true});
    if protocol == "sftp" {
        result["warnings"] = json!(["SFTP uses system OpenSSH and the Accept known-host strategy: new host keys are trusted on first use. Independently verify host keys before production use. Password authentication is unsupported; private_key is an absolute key-file path."]);
    }
    result
}

fn evict_idle(sessions: &Mutex<HashMap<String, Arc<Session>>>) {
    let mut sessions = sessions.lock().unwrap();
    sessions.retain(|_, s| {
        if s.idle() {
            s.closed.cancel();
            s.cursors.lock().unwrap().clear();
            false
        } else {
            true
        }
    });
}

pub struct Handler(pub Arc<Plugin>);

impl PluginHandler for Handler {
    fn handle(
        &self,
        _context: RequestContext,
        method: &str,
        params: Value,
        emitter: &PluginEmitter,
    ) -> Result<Value> {
        self.0.invoke(method, params, Some(emitter.clone()))
    }
}

#[cfg(test)]
mod tests;
