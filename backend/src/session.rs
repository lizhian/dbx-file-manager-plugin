use crate::error::{error, Result};
use opendal::{Lister, Operator};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex as AsyncMutex, Notify, RwLock, Semaphore};
use tokio_util::sync::CancellationToken;

pub struct Cursor {
    pub path: String,
    pub lister: Lister,
    pub touched: Instant,
    pub pending: Option<serde_json::Value>,
}

pub struct Session {
    pub id: String,
    pub verified: bool,
    operator: Operator,
    capability: opendal::Capability,
    read_only: bool,
    closed: CancellationToken,
    pub gate: RwLock<()>,
    pub mutations: AsyncMutex<()>,
    pub permits: Arc<Semaphore>,
    pub cursors: Mutex<HashMap<String, Cursor>>,
    pub generation: u64,
    pub fingerprint: [u8; 32],
    pub operation_timeout: Option<Duration>,
    pub idle_timeout: Duration,
    pub last_used: Mutex<Instant>,
    active: AtomicUsize,
    drained: Notify,
}

impl Session {
    pub async fn verify(&mut self, timeout: Duration) -> Result<()> {
        self.verified = if self.capability.list {
            match tokio::time::timeout(timeout, self.operator.check())
                .await
                .map_err(|_| error("timeout", "Connection check timed out"))?
            {
                Ok(()) => true,
                Err(e) if e.kind() == opendal::ErrorKind::Unsupported => false,
                Err(e) => return Err(crate::error::remote(e)),
            }
        } else {
            false
        };
        Ok(())
    }

    pub async fn execute(&self, method: &str, params: &Value, global: &Semaphore) -> Result<Value> {
        let mutation = matches!(
            method,
            "filesystem/write"
                | "filesystem/createDirectory"
                | "filesystem/delete"
                | "filesystem/rename"
                | "filesystem/copy"
        );
        if mutation {
            self.writable()?;
        }
        let operation = async {
            let _gate = self.gate.read().await;
            self.available()?;
            let _connection = self
                .permits
                .acquire()
                .await
                .map_err(|_| error("unavailable", "Connection slots unavailable"))?;
            let _global = global
                .acquire()
                .await
                .map_err(|_| error("unavailable", "Operation slots unavailable"))?;
            crate::operations::dispatch(self, method, params).await
        };
        let deadline = async {
            if let Some(timeout) = self.operation_timeout {
                tokio::time::sleep(timeout).await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        let result = tokio::select! {
            biased;
            _ = self.cancellation().cancelled() => Err(error("not_connected", "Connection generation was closed")),
            _ = deadline => Err(error("timeout", "Remote operation timed out")),
            result = operation => result,
        };
        result.map_err(|e| {
                    if mutation && e.data.as_ref().is_some_and(|d| d["code"] == "timeout" || d["code"] == "not_connected") {
                        crate::error::recovery(e, json!({"action": "inspect_both_locations", "sourceUri": params.get("sourceUri"),
                            "targetUri": params.get("targetUri").or(params.get("uri")), "destinationMayExist": true, "sourceMayExist": true}))
                    } else { e }
                })
    }

    pub fn operator(&self) -> &Operator {
        &self.operator
    }
    pub fn raw_capability(&self) -> opendal::Capability {
        self.capability
    }
    pub fn cancellation(&self) -> &CancellationToken {
        &self.closed
    }

    pub fn capabilities(&self) -> Value {
        let c = self.capability;
        let writable = !self.read_only;
        let mut result = json!({"list": c.list, "read": c.read, "stat": c.stat,
        "write": writable && c.write && c.stat, "mkdir": writable && c.create_dir && c.stat,
        "delete": writable && c.delete && c.stat,
        "copy": writable && c.stat && (c.copy || (c.read && c.write)),
        "rename": writable && c.stat && (c.rename || ((c.copy || (c.read && c.write)) && c.delete)),
        "upload": writable && c.stat && c.write && c.delete && (c.rename || c.copy || c.read), "download": c.read,
        "edit": writable && c.stat && c.read && c.write,
        "rootUri": "opendal:/", "verification": if self.verified { "verified" } else { "configuration_only" },
        "recursiveDelete": false, "recursiveCopy": false, "atomicRename": false, "atomicNoClobber": false,
        "nativeCopy": c.copy, "nativeRename": c.rename,
        "copyMode": if c.copy { "native" } else { "stream" },
        "renameMode": if c.rename { "native" } else { "copy-delete" },
        "directoryRenameMode": "copy-delete", "readOnly": self.read_only});
        result["capabilities"] = json!([
            "list", "read", "stat", "write", "mkdir", "delete", "copy", "rename", "upload",
            "download"
        ]
        .into_iter()
        .filter(|key| result[*key] == true)
        .collect::<Vec<_>>());
        result
    }

    pub fn require(&self, capability: &str) -> Result<()> {
        self.available()?;
        if matches!(
            capability,
            "write" | "mkdir" | "delete" | "copy" | "rename" | "upload" | "edit"
        ) {
            self.writable()?;
        }
        if self.capabilities()[capability] != true {
            return Err(error(
                "unsupported",
                &format!(
                    "Connection does not support {capability} with the required file-management guarantees"
                ),
            ));
        }
        Ok(())
    }

    pub fn new(id: String, operator: Operator, read_only: bool) -> Self {
        Self {
            id,
            verified: false,
            capability: operator.info().full_capability(),
            operator,
            read_only,
            closed: CancellationToken::new(),
            gate: RwLock::new(()),
            mutations: AsyncMutex::new(()),
            permits: Arc::new(Semaphore::new(2)),
            cursors: Mutex::new(HashMap::new()),
            generation: 0,
            fingerprint: [0; 32],
            operation_timeout: Some(Duration::from_secs(60)),
            idle_timeout: Duration::from_secs(60),
            last_used: Mutex::new(Instant::now()),
            active: AtomicUsize::new(0),
            drained: Notify::new(),
        }
    }

    pub fn path(&self, location: &str) -> Result<String> {
        crate::uri::path(location, "opendal")
    }
    pub fn uri(&self, path: &str) -> String {
        crate::uri::uri("opendal", path)
    }
    pub fn available(&self) -> Result<()> {
        if self.closed.is_cancelled() {
            Err(error("not_connected", "Connection is disconnected"))
        } else {
            Ok(())
        }
    }
    pub fn writable(&self) -> Result<()> {
        self.available()?;
        if self.read_only {
            Err(error("read_only", "This connection is read-only"))
        } else {
            Ok(())
        }
    }
    pub fn prune_cursors(cursors: &mut HashMap<String, Cursor>) {
        cursors.retain(|_, cursor| cursor.touched.elapsed() < Duration::from_secs(300));
    }

    pub fn idle(&self) -> bool {
        self.active.load(Ordering::SeqCst) == 0
            && self.last_used.lock().unwrap().elapsed() >= self.idle_timeout
    }

    pub fn activity(self: &Arc<Self>) -> Activity {
        self.active.fetch_add(1, Ordering::SeqCst);
        *self.last_used.lock().unwrap() = Instant::now();
        Activity(self.clone())
    }

    pub async fn wait_drained(&self) {
        loop {
            let notified = self.drained.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.active.load(Ordering::SeqCst) == 0 {
                return;
            }
            notified.await;
        }
    }
}

pub struct Activity(Arc<Session>);
impl Drop for Activity {
    fn drop(&mut self) {
        *self.0.last_used.lock().unwrap() = Instant::now();
        if self.0.active.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.drained.notify_waiters();
        }
    }
}
