use crate::{
    config::PLUGIN_ID,
    error::{error, Result},
};
use opendal::{Lister, Operator};
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
    pub provider_id: String,
    pub operator: Operator,
    pub read_only: bool,
    pub closed: CancellationToken,
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
    pub fn new(id: String, operator: Operator, read_only: bool) -> Self {
        Self {
            id,
            provider_id: format!("{PLUGIN_ID}.files"),
            verified: false,
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

    pub fn storage_scheme(&self) -> &str {
        self.operator.info().scheme()
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
