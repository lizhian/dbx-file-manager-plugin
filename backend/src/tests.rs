use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use opendal::{services, Operator};
use std::sync::atomic::{AtomicBool, Ordering};

fn memory(read_only: bool) -> (Plugin, Arc<Session>) {
    let p = Plugin::new().unwrap();
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let s = Arc::new(Session::new("test".into(), "ftp".into(), op, read_only));
    p.sessions.lock().unwrap().insert(s.id.clone(), s.clone());
    (p, s)
}

fn params() -> Value {
    json!({"providerId": format!("{PLUGIN_ID}.ftp.files"), "connectionId": "test", "uri": "ftp:/"})
}

#[test]
fn host_10_secret_bound_configuration_preserves_typed_legacy_support() {
    let mut c = connection("s3");
    c["connection"]["external_config"] = Value::Null;
    c["connection"]["connection_secrets"] = json!({"root": "/", "endpoint": "http://127.0.0.1:9000", "region": "us-east-1", "bucket": "dbx", "path_style": "true", "access_key": "key", "secret_key": "secret"});
    let parsed = ConnectionRequest::parse(c.clone()).unwrap();
    assert_eq!(parsed.connection.external_config["path_style"], true);
    assert_eq!(parsed.connection.external_config["bucket"], "dbx");
    assert_eq!(parsed.connection.connection_secrets["secret_key"], "secret");
    c["connection"]["connection_secrets"]["path_style"] = json!("invalid");
    assert!(ConnectionRequest::parse(c).is_err());
    assert_eq!(
        ConnectionRequest::parse(connection("s3"))
            .unwrap()
            .connection
            .external_config["bucket"],
        "dbx"
    );
}

#[test]
#[ignore = "Writes isolated temporary files to the six existing docs/tests services"]
fn live_workbench_six_protocols() {
    use sha2::{Digest, Sha256};
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let p = Plugin::new().unwrap();
    let local = tempfile::tempdir().unwrap();
    let source = local.path().join("source.txt");
    std::fs::write(&source, "live original\n").unwrap();
    for protocol in config::PROTOCOLS {
        let mut c = connection(protocol);
        let (port, root) = match protocol {
            "ftp" => (2121, "/ftp/dbx/"),
            "sftp" => (2222, "/config/"),
            _ => (9000, "/"),
        };
        c["connection"]["port"] = json!(port);
        c["connection"]["external_config"] = json!({"root": root});
        c["connection"]["connection_secrets"] = json!({});
        c["runtime"] = Value::Null;
        match protocol {
            "ftp" => c["connection"]["connection_secrets"] = json!({"password": "dbx-password"}),
            "sftp" => {
                c["connection"]["external_config"]["authentication"] = json!("private_key");
                c["connection"]["connection_secrets"] =
                    json!({"private_key": repo.join("docs/tests/runtime/sftp/id_ed25519")});
            }
            "s3" => {
                c["connection"]["external_config"] = json!({"root": "/", "endpoint": "http://127.0.0.1:9000", "region": "us-east-1", "bucket": "dbx", "path_style": true});
                c["connection"]["connection_secrets"] =
                    json!({"access_key": "dbx-access-key", "secret_key": "dbx-secret-key"});
            }
            "webdav" => {
                c["connection"]["external_config"] = json!({"root": "/", "endpoint": "http://127.0.0.1:8080", "authentication": "basic"});
                c["connection"]["connection_secrets"] = json!({"password": "dbx-password"});
            }
            "webhdfs" => {
                c["connection"]["external_config"] =
                    json!({"root": "/", "endpoint": "http://127.0.0.1:9870", "simple_user": "dbx"})
            }
            "hdfs-native" => {
                c["connection"]["external_config"] = json!({"root": "/", "name_node_uri": "hdfs://127.0.0.1:19000", "hadoop_config_directory": repo.join("docs/tests/config/hadoop/client")})
            }
            _ => unreachable!(),
        }
        p.invoke("connection/connect", c.clone(), None)
            .unwrap_or_else(|e| panic!("{protocol} connect: {e:?}"));
        let invoke = |method: &str, extras: Value| {
            let mut params = json!({"connectionId": "test", "providerId": format!("{PLUGIN_ID}.{protocol}.files")});
            params
                .as_object_mut()
                .unwrap()
                .extend(extras.as_object().unwrap().clone());
            let response = p
                .invoke(method, params, None)
                .unwrap_or_else(|e| panic!("{protocol} {method}: {e:?}"));
            if method.starts_with("workbench/") {
                assert_eq!(response["ok"], true, "{protocol} {method}: {response}");
                response["value"].clone()
            } else {
                response
            }
        };
        let folder = format!("{protocol}:/dbx-workbench-{}", uuid::Uuid::new_v4());
        let file = format!("{folder}/original.txt");
        invoke("workbench/createDirectory", json!({"uri": folder}));
        let task = invoke(
            "filesystem/transfer/startUpload",
            json!({"uri": file, "localPath": source}),
        );
        let wait = |id: &Value| {
            let start = std::time::Instant::now();
            loop {
                let state = invoke("workbench/transfer/status", json!({"transferId": id}));
                if matches!(
                    state["state"].as_str(),
                    Some("completed" | "failed" | "cancelled")
                ) {
                    assert_eq!(state["state"], "completed", "{protocol}: {state}");
                    break;
                }
                assert!(start.elapsed() < Duration::from_secs(90));
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        wait(&task["transferId"]);
        let listing = invoke("workbench/list", json!({"uri": folder, "limit": 200}));
        assert!(listing["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["name"] == "original.txt"));
        let preview = invoke("workbench/preview", json!({"uri": file}));
        let token = &preview["token"];
        assert_eq!(preview["kind"], "text");
        let changed = "edited 中文\n";
        invoke(
            "workbench/stageText",
            json!({"token": token, "offset": 0, "dataBase64": STANDARD.encode(changed)}),
        );
        invoke(
            "workbench/saveText",
            json!({"token": token, "size": changed.len(), "digest": format!("{:x}", Sha256::digest(changed))}),
        );
        invoke("workbench/releasePreview", json!({"token": token}));
        let renamed = format!("{folder}/renamed.txt");
        invoke(
            "workbench/rename",
            json!({"sourceUri": file, "targetUri": renamed}),
        );
        let download = local.path().join(format!("{protocol}.txt"));
        let task = invoke(
            "filesystem/transfer/startDownload",
            json!({"uri": renamed, "localPath": download}),
        );
        wait(&task["transferId"]);
        assert_eq!(std::fs::read(&download).unwrap(), changed.as_bytes());
        let image = format!("{folder}/preview.png");
        invoke(
            "filesystem/write",
            json!({"uri": image, "dataBase64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII="}),
        );
        let preview = invoke("workbench/preview", json!({"uri": image}));
        assert_eq!(preview["kind"], "image");
        invoke(
            "workbench/releasePreview",
            json!({"token": preview["token"]}),
        );
        invoke("workbench/delete", json!({"uri": image}));
        invoke("workbench/delete", json!({"uri": renamed}));
        invoke("workbench/delete", json!({"uri": folder}));
        p.invoke("connection/disconnect", c, None).unwrap();
        eprintln!("PASS {protocol}: upload/list/text edit/rename/download/image/delete/cleanup");
    }
    p.shutdown();
}

fn wb(p: &Plugin, method: &str, extras: Value) -> Value {
    call(p, &format!("workbench/{method}"), extras).unwrap()
}

#[test]
fn workbench_preview_chunks_and_conflict_checked_text_save() {
    use sha2::{Digest, Sha256};
    let (p, s) = memory(false);
    p.runtime
        .block_on(s.operator.write("edit.txt", "original"))
        .unwrap();
    let preview = wb(&p, "preview", json!({"uri": "ftp:/edit.txt"}));
    assert_eq!(preview["ok"], true);
    let token = &preview["value"]["token"];
    assert_eq!(
        wb(&p, "previewChunk", json!({"token": token, "offset": 0}))["value"]["dataBase64"],
        STANDARD.encode("original")
    );
    let draft = "中文 updated";
    assert_eq!(
        wb(
            &p,
            "stageText",
            json!({"token": token, "offset": 0, "dataBase64": STANDARD.encode(draft)})
        )["ok"],
        true
    );
    let save = json!({"token": token, "size": draft.len(), "digest": format!("{:x}", Sha256::digest(draft))});
    p.runtime
        .block_on(s.operator.write("edit.txt", "concurrent change"))
        .unwrap();
    assert_eq!(
        wb(&p, "saveText", save.clone())["error"]["details"]["code"],
        "conflict"
    );
    assert_eq!(
        p.runtime
            .block_on(s.operator.read("edit.txt"))
            .unwrap()
            .to_vec(),
        b"concurrent change"
    );
    let mut force = save;
    force["force"] = json!(true);
    assert_eq!(wb(&p, "saveText", force)["ok"], true);
    assert_eq!(
        p.runtime
            .block_on(s.operator.read("edit.txt"))
            .unwrap()
            .to_vec(),
        draft.as_bytes()
    );
    wb(&p, "releasePreview", json!({"token": token}));
    assert_eq!(
        wb(&p, "previewChunk", json!({"token": token, "offset": 0}))["error"]["details"]["code"],
        "expired"
    );
}

#[test]
fn workbench_rejects_binary_oversize_cross_connection_and_incomplete_drafts() {
    let (p, s) = memory(false);
    p.runtime.block_on(async {
        s.operator.write("binary", vec![0, 1, 2]).await.unwrap();
        s.operator
            .write("large", vec![b'x'; 2 * 1024 * 1024 + 1])
            .await
            .unwrap();
        s.operator.write("text", "hello").await.unwrap();
    });
    assert_eq!(
        wb(&p, "preview", json!({"uri": "ftp:/binary"}))["error"]["details"]["code"],
        "unsupported"
    );
    assert_eq!(
        wb(&p, "preview", json!({"uri": "ftp:/large"}))["error"]["details"]["code"],
        "too_large"
    );
    let token = wb(&p, "preview", json!({"uri": "ftp:/text"}))["value"]["token"].clone();
    assert_eq!(
        wb(
            &p,
            "saveText",
            json!({"token": token, "size": 1, "digest": "wrong"})
        )["ok"],
        false
    );
    assert_eq!(
        wb(
            &p,
            "stageText",
            json!({"token": token, "offset": 4, "dataBase64": "YQ=="})
        )["ok"],
        false
    );
    assert_eq!(
        wb(&p, "previewChunk", json!({"token": token, "offset": 99}))["ok"],
        false
    );
    assert_eq!(
        wb(&p, "preview", json!({"uri": "ftp:/../secret"}))["ok"],
        false
    );
    let other = Arc::new(Session::new(
        "other".into(),
        "ftp".into(),
        s.operator.clone(),
        false,
    ));
    p.sessions.lock().unwrap().insert("other".into(), other);
    assert_eq!(
        wb(
            &p,
            "previewChunk",
            json!({"connectionId": "other", "token": token, "offset": 0})
        )["error"]["details"]["code"],
        "expired"
    );
    assert_eq!(
        wb(
            &p,
            "startTransfer",
            json!({"token": "invented", "localPath": "/tmp/forged", "uri": "ftp:/text"})
        )["ok"],
        false
    );
}

#[test]
fn workbench_images_are_signature_checked_chunked_and_not_editable() {
    let (p, s) = memory(false);
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(1024 * 1024, 1);
    p.runtime
        .block_on(s.operator.write("image", bytes.clone()))
        .unwrap();
    let preview = wb(&p, "preview", json!({"uri": "ftp:/image"}));
    assert_eq!(preview["value"]["kind"], "image");
    let token = &preview["value"]["token"];
    let chunk = wb(&p, "previewChunk", json!({"token": token, "offset": 0}));
    assert_eq!(
        STANDARD
            .decode(chunk["value"]["dataBase64"].as_str().unwrap())
            .unwrap()
            .len(),
        512 * 1024
    );
    assert_eq!(
        wb(
            &p,
            "stageText",
            json!({"token": token, "offset": 0, "dataBase64": ""})
        )["ok"],
        false
    );
    let (read_only, ro) = memory(true);
    read_only
        .runtime
        .block_on(ro.operator.write("text", "hello"))
        .unwrap();
    let token = wb(&read_only, "preview", json!({"uri": "ftp:/text"}))["value"]["token"].clone();
    assert_eq!(
        wb(
            &read_only,
            "stageText",
            json!({"token": token, "offset": 0, "dataBase64": ""})
        )["ok"],
        false
    );
}
fn call(p: &Plugin, method: &str, extras: Value) -> Result<Value> {
    let mut value = params();
    value
        .as_object_mut()
        .unwrap()
        .extend(extras.as_object().unwrap().clone());
    p.invoke(method, value, None)
}
fn code(e: PluginError) -> String {
    e.data.unwrap()["code"].as_str().unwrap().into()
}

fn wait_task(p: &Plugin, id: &str) -> Value {
    let start = std::time::Instant::now();
    loop {
        let status = call(p, "filesystem/transfer/status", json!({"transferId": id})).unwrap();
        if matches!(
            status["state"].as_str(),
            Some("completed" | "failed" | "cancelled")
        ) {
            return status;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "Task did not finish: {status}"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn connection(protocol: &str) -> Value {
    json!({"provider": {"id": format!("{PLUGIN_ID}.{protocol}"), "databaseType": protocol},
        "connection": {"id": "test", "plugin_id": PLUGIN_ID,
            "plugin_connection_provider": format!("{PLUGIN_ID}.{protocol}"), "plugin_connection_type": protocol,
            "host": "127.0.0.1", "port": 9000, "username": "dbx", "read_only": false,
            "external_config": {"endpoint": "http://127.0.0.1:9000", "region": "us-east-1", "bucket": "dbx"},
            "connection_secrets": {"access_key": "key", "secret_key": "secret"}},
        "runtime": {"host": "127.0.0.1", "port": 9000}})
}

fn configurable_operator(op: Operator) -> (Plugin, Arc<std::sync::atomic::AtomicUsize>) {
    let p = Plugin::new().unwrap();
    let builds = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = builds.clone();
    *p.operator_factory.lock().unwrap() = Some(Arc::new(move |_| {
        count.fetch_add(1, Ordering::SeqCst);
        Ok(op.clone())
    }));
    (p, builds)
}

#[test]
fn query_and_idle_common_fields_preserve_zero_semantics() {
    let mut params = connection("ftp");
    let request = ConnectionRequest::parse(params.clone()).unwrap();
    assert_eq!(
        request.query_timeout().unwrap(),
        Some(Duration::from_secs(60))
    );
    assert_eq!(request.idle_timeout().unwrap(), Duration::from_secs(60));
    params["connection"]["query_timeout_secs"] = json!(0);
    params["connection"]["idle_timeout_secs"] = json!(0);
    let request = ConnectionRequest::parse(params.clone()).unwrap();
    assert_eq!(request.query_timeout().unwrap(), None);
    assert_eq!(request.idle_timeout().unwrap(), Duration::ZERO);
    for invalid in [json!(-1), json!("60"), json!(true), json!(u64::MAX)] {
        params["connection"]["query_timeout_secs"] = invalid;
        assert!(ConnectionRequest::parse(params.clone()).is_err());
    }
    assert_eq!(transfer::effective_timeout(None, &json!({})).unwrap(), None);
    assert_eq!(
        transfer::effective_timeout(None, &json!({"timeoutMs": 0})).unwrap(),
        None
    );
    assert_eq!(
        transfer::effective_timeout(Some(Duration::from_secs(2)), &json!({"timeoutMs": 0}))
            .unwrap(),
        Some(Duration::from_secs(2))
    );
    assert_eq!(
        transfer::effective_timeout(Some(Duration::from_secs(2)), &json!({"timeoutMs": 10}))
            .unwrap(),
        Some(Duration::from_millis(10))
    );
    assert_eq!(
        transfer::effective_timeout(Some(Duration::from_secs(2)), &json!({"timeoutMs": 3000}))
            .unwrap(),
        Some(Duration::from_secs(2))
    );
}

#[test]
fn concurrent_first_connect_and_same_config_are_idempotent() {
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let (p, builds) = configurable_operator(op);
    let barrier = std::sync::Barrier::new(8);
    std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..8)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    p.invoke("connection/connect", connection("ftp"), None)
                        .unwrap()
                })
            })
            .collect();
        for job in jobs {
            assert_eq!(job.join().unwrap()["success"], true);
        }
    });
    assert_eq!(builds.load(Ordering::SeqCst), 1);
    let original = p.sessions.lock().unwrap()["test"].clone();
    p.invoke("connection/connect", connection("ftp"), None)
        .unwrap();
    let retained = p.sessions.lock().unwrap()["test"].clone();
    assert!(Arc::ptr_eq(&original, &retained));
    assert_eq!(original.generation, retained.generation);
    assert_eq!(builds.load(Ordering::SeqCst), 1);
}

#[test]
fn config_replacement_drains_old_generation_and_invalidates_cursors() {
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let (p, builds) = configurable_operator(op.clone());
    p.runtime.block_on(async {
        op.write("a", "a").await.unwrap();
        op.write("b", "b").await.unwrap();
    });
    p.invoke("connection/connect", connection("ftp"), None)
        .unwrap();
    let page = call(&p, "filesystem/list", json!({"limit": 1})).unwrap();
    let old = p.sessions.lock().unwrap()["test"].clone();
    let _slots = p.runtime.block_on(old.permits.acquire_many(2)).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let task = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/a", "localPath": temp.path().join("unused")}),
    )
    .unwrap();
    let mut changed = connection("ftp");
    changed["connection"]["read_only"] = json!(true);
    p.invoke("connection/connect", changed, None).unwrap();
    let new = p.sessions.lock().unwrap()["test"].clone();
    assert!(new.generation > old.generation);
    assert!(old.closed.is_cancelled());
    assert!(!new.closed.is_cancelled());
    assert_eq!(builds.load(Ordering::SeqCst), 2);
    assert_eq!(
        wait_task(&p, task["transferId"].as_str().unwrap())["state"],
        "cancelled"
    );
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/write",
                json!({"uri": "ftp:/new", "dataBase64": ""})
            )
            .unwrap_err()
        ),
        "read_only"
    );
    assert_eq!(
        code(call(&p, "filesystem/list", json!({"cursor": page["nextCursor"]})).unwrap_err()),
        "invalid_cursor"
    );
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn idle_reclaims_operator_but_preserves_descriptor_and_rebuilds_once() {
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let (p, builds) = configurable_operator(op);
    let mut request = connection("ftp");
    request["connection"]["idle_timeout_secs"] = json!(1);
    p.invoke("connection/connect", request.clone(), None)
        .unwrap();
    let old = p.sessions.lock().unwrap()["test"].clone();
    *old.last_used.lock().unwrap() = std::time::Instant::now() - Duration::from_secs(2);
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while p.sessions.lock().unwrap().contains_key("test") {
        assert!(
            std::time::Instant::now() < deadline,
            "Idle maintenance did not run"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(old.closed.is_cancelled());
    assert!(p.descriptors.lock().unwrap().contains_key("test"));
    call(&p, "filesystem/stat", json!({})).unwrap();
    let rebuilt = p.sessions.lock().unwrap()["test"].clone();
    assert!(rebuilt.generation > old.generation);
    assert_eq!(builds.load(Ordering::SeqCst), 2);
    request["connection"]["idle_timeout_secs"] = json!(0);
    p.invoke("connection/connect", request, None).unwrap();
    let before = builds.load(Ordering::SeqCst);
    call(&p, "filesystem/capabilities", json!({})).unwrap();
    call(&p, "filesystem/stat", json!({})).unwrap();
    assert_eq!(builds.load(Ordering::SeqCst), before + 2);
    p.invoke("connection/disconnect", connection("ftp"), None)
        .unwrap();
    assert!(!p.descriptors.lock().unwrap().contains_key("test"));
    assert_eq!(
        code(call(&p, "filesystem/stat", json!({})).unwrap_err()),
        "not_connected"
    );
}

#[test]
fn idle_never_evicts_queued_transfer_and_reclaims_after_cleanup() {
    let (p, _) = memory(false);
    let op = p.sessions.lock().unwrap()["test"].operator.clone();
    let mut session = Session::new("test".into(), "ftp".into(), op, false);
    session.idle_timeout = Duration::ZERO;
    let s = Arc::new(session);
    let seed_activity = s.activity();
    p.sessions.lock().unwrap().insert("test".into(), s.clone());
    let _slots = p.runtime.block_on(s.permits.acquire_many(2)).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let task = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/file", "localPath": temp.path().join("target")}),
    )
    .unwrap();
    drop(seed_activity);
    evict_idle(&p.sessions);
    assert!(p.sessions.lock().unwrap().contains_key("test"));
    assert!(!s.closed.is_cancelled());
    call(
        &p,
        "filesystem/transfer/cancel",
        json!({"transferId": task["transferId"]}),
    )
    .unwrap();
    wait_task(&p, task["transferId"].as_str().unwrap());
    p.runtime.block_on(s.wait_drained());
    evict_idle(&p.sessions);
    assert!(!p.sessions.lock().unwrap().contains_key("test"));
}

#[test]
fn saved_query_timeout_controls_rpc_and_zero_waits_until_disconnect() {
    for seconds in [1, 0] {
        let op = Operator::new(services::Memory::default()).unwrap().finish();
        let entered = Arc::new(AtomicBool::new(false));
        let (p, _) = configurable_operator(op.clone().layer(SlowRead(entered.clone())));
        p.runtime.block_on(op.write("source", "content")).unwrap();
        let mut request = connection("ftp");
        request["connection"]["query_timeout_secs"] = json!(seconds);
        p.invoke("connection/connect", request.clone(), None)
            .unwrap();
        std::thread::scope(|scope| {
            let (sender, receiver) = std::sync::mpsc::channel();
            let plugin = &p;
            scope.spawn(move || {
                sender
                    .send(call(
                        plugin,
                        "filesystem/read",
                        json!({"uri": "ftp:/source"}),
                    ))
                    .unwrap()
            });
            if seconds == 0 {
                assert!(receiver.recv_timeout(Duration::from_millis(150)).is_err());
                assert!(entered.load(Ordering::SeqCst));
                p.invoke("connection/disconnect", request, None).unwrap();
                assert_eq!(
                    code(
                        receiver
                            .recv_timeout(Duration::from_secs(1))
                            .unwrap()
                            .unwrap_err()
                    ),
                    "not_connected"
                );
            } else {
                assert_eq!(
                    code(
                        receiver
                            .recv_timeout(Duration::from_secs(2))
                            .unwrap()
                            .unwrap_err()
                    ),
                    "timeout"
                );
            }
        });
    }
}

#[test]
fn saved_query_timeout_controls_transfer_without_per_task_override() {
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let (p, _) =
        configurable_operator(op.clone().layer(SlowRead(Arc::new(AtomicBool::new(false)))));
    p.runtime.block_on(op.write("source", "content")).unwrap();
    let temp = tempfile::tempdir().unwrap();
    for seconds in [1, 0] {
        let mut request = connection("ftp");
        request["connection"]["query_timeout_secs"] = json!(seconds);
        p.invoke("connection/connect", request, None).unwrap();
        let task = call(
            &p,
            "filesystem/transfer/startDownload",
            json!({"uri": "ftp:/source", "localPath": temp.path().join("target")}),
        )
        .unwrap();
        if seconds == 0 {
            std::thread::sleep(Duration::from_millis(150));
            assert_eq!(
                call(
                    &p,
                    "filesystem/transfer/status",
                    json!({"transferId": task["transferId"]})
                )
                .unwrap()["state"],
                "running"
            );
            call(
                &p,
                "filesystem/transfer/cancel",
                json!({"transferId": task["transferId"]}),
            )
            .unwrap();
        }
        let status = wait_task(&p, task["transferId"].as_str().unwrap());
        assert_eq!(
            status["error"]["data"]["code"],
            if seconds == 0 { "cancelled" } else { "timeout" }
        );
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
}

#[test]
fn disconnect_during_first_build_cannot_leave_a_late_published_generation() {
    let p = Plugin::new().unwrap();
    let op = Operator::new(services::Memory::default()).unwrap().finish();
    let (entered, did_enter) = std::sync::mpsc::channel();
    let (resume, resumed) = std::sync::mpsc::channel();
    let resumed = Mutex::new(resumed);
    *p.operator_factory.lock().unwrap() = Some(Arc::new(move |_| {
        entered.send(()).unwrap();
        resumed
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        Ok(op.clone())
    }));
    std::thread::scope(|scope| {
        let connect = scope.spawn(|| p.invoke("connection/connect", connection("ftp"), None));
        did_enter.recv_timeout(Duration::from_secs(1)).unwrap();
        let disconnect = scope.spawn(|| p.invoke("connection/disconnect", connection("ftp"), None));
        resume.send(()).unwrap();
        connect.join().unwrap().unwrap();
        disconnect.join().unwrap().unwrap();
    });
    assert_eq!(p.generation.load(Ordering::SeqCst), 1);
    assert!(p.sessions.lock().unwrap().is_empty());
    assert!(p.descriptors.lock().unwrap().is_empty());
    assert_eq!(
        code(call(&p, "filesystem/stat", json!({})).unwrap_err()),
        "not_connected"
    );
}

#[test]
fn fingerprints_include_credentials_read_only_and_runtime_endpoint() {
    let base = connection("ftp");
    let original = ConnectionRequest::parse(base.clone()).unwrap().fingerprint;
    assert_eq!(
        original,
        ConnectionRequest::parse(base.clone()).unwrap().fingerprint
    );
    for pointer in [
        "/connection/read_only",
        "/connection/connection_secrets/password",
        "/runtime/port",
    ] {
        let mut changed = base.clone();
        match pointer {
            "/connection/read_only" => changed["connection"]["read_only"] = json!(true),
            "/connection/connection_secrets/password" => {
                changed["connection"]["connection_secrets"]["password"] = json!("different")
            }
            _ => changed["runtime"]["port"] = json!(2222),
        }
        assert_ne!(
            original,
            ConnectionRequest::parse(changed).unwrap().fingerprint
        );
    }
}

#[test]
fn uri_rejects_authorities_traversal_and_ambiguous_encodings() {
    for path in [
        "ftp://host/a",
        "ftp:///a",
        "s3:/a",
        "ftp:/../a",
        "ftp:/%2e%2e/a",
        "ftp:/%252e%252e/a",
        "ftp:/%2fa",
        "ftp:/%5ca",
        "ftp:/a\\b",
        "ftp:/a?b",
        "ftp:/a#b",
        "ftp:/a//b",
        "ftp:/a/./b",
        "ftp:/%00",
        "ftp:/%",
        "ftp:/%xy",
        "ftp:/%ff",
    ] {
        assert!(uri::path(path, "ftp").is_err(), "Accepted {path}");
    }
    assert_eq!(uri::path("ftp:/", "ftp").unwrap(), "");
    assert_eq!(uri::path("ftp:/a%20b/c/", "ftp").unwrap(), "a b/c/");
    assert_eq!(
        uri::path(&uri::uri("ftp", "a #?%/b"), "ftp").unwrap(),
        "a #?%/b"
    );
}

#[test]
fn binding_must_match_protocol_not_only_spoofed_equal_strings() {
    let mut value = connection("s3");
    value["provider"]["databaseType"] = json!("spoofed");
    value["connection"]["plugin_connection_type"] = json!("spoofed");
    assert_eq!(
        code(ConnectionRequest::parse(value).err().unwrap()),
        "configuration"
    );
}

#[test]
fn transport_layers_default_enabled_but_runtime_presence_is_not_override() {
    let p = Plugin::new().unwrap();
    p.runtime.block_on(async {
        let value = connection("s3");
        assert!(ConnectionRequest::parse(value.clone())
            .unwrap()
            .build()
            .is_ok());
        let mut enabled = value.clone();
        enabled["connection"]["transport_layers"] = json!([{"type": "ssh"}]);
        assert_eq!(
            code(
                ConnectionRequest::parse(enabled)
                    .unwrap()
                    .build()
                    .unwrap_err()
            ),
            "unsupported"
        );
        let mut disabled = value.clone();
        disabled["connection"]["transport_layers"] = json!([{"type": "ssh", "enabled": false}]);
        assert!(ConnectionRequest::parse(disabled).unwrap().build().is_ok());
        let mut changed = value;
        changed["runtime"]["port"] = json!(12345);
        assert_eq!(
            code(
                ConnectionRequest::parse(changed)
                    .unwrap()
                    .build()
                    .unwrap_err()
            ),
            "unsupported"
        );
    });
}

#[test]
fn ftp_runtime_override_and_public_password_fallback_build() {
    let p = Plugin::new().unwrap();
    p.runtime.block_on(async {
        let mut value = connection("ftp");
        value["connection"]["password"] = json!("fallback-password");
        value["runtime"]["port"] = json!(2121);
        value["connection"]["transport_layers"] = json!([{"type": "ssh", "enabled": true}]);
        assert!(ConnectionRequest::parse(value).unwrap().build().is_ok());
    });
}

#[test]
fn read_only_enforced_for_every_mutation_before_io() {
    let (p, _) = memory(true);
    for method in [
        "filesystem/write",
        "filesystem/createDirectory",
        "filesystem/delete",
        "filesystem/copy",
        "filesystem/rename",
        "filesystem/transfer/startUpload",
    ] {
        assert_eq!(
            code(call(&p, method, json!({})).unwrap_err()),
            "read_only",
            "{method}"
        );
    }
    let cap = call(&p, "filesystem/capabilities", json!({})).unwrap();
    for key in ["write", "mkdir", "delete", "copy", "rename", "upload"] {
        assert_eq!(cap[key], false);
    }
    assert_eq!(cap["download"], true);
}

#[test]
fn provider_binding_and_root_mutations_are_rejected() {
    let (p, _) = memory(false);
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/stat",
                json!({"providerId": format!("{PLUGIN_ID}.s3.files")})
            )
            .unwrap_err()
        ),
        "configuration"
    );
    for method in [
        "filesystem/write",
        "filesystem/createDirectory",
        "filesystem/delete",
    ] {
        assert_eq!(
            code(call(&p, method, json!({"uri": "ftp:/"})).unwrap_err()),
            "configuration"
        );
    }
}

#[test]
fn filesystem_memory_round_trip_and_no_clobber() {
    let (p, _) = memory(false);
    call(&p, "filesystem/createDirectory", json!({"uri": "ftp:/dir"})).unwrap();
    call(
        &p,
        "filesystem/write",
        json!({"uri": "ftp:/dir/source", "dataBase64": STANDARD.encode(b"abcdef")}),
    )
    .unwrap();
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/write",
                json!({"uri": "ftp:/dir/source", "dataBase64": ""})
            )
            .unwrap_err()
        ),
        "already_exists"
    );
    let read = call(
        &p,
        "filesystem/read",
        json!({"uri": "ftp:/dir/source", "maxBytes": 3}),
    )
    .unwrap();
    assert_eq!(read["dataBase64"], STANDARD.encode(b"abc"));
    assert_eq!(read["truncated"], true);
    let stat = call(&p, "filesystem/stat", json!({"uri": "ftp:/dir/source"})).unwrap();
    assert_eq!(stat["size"], 6);
    call(
        &p,
        "filesystem/copy",
        json!({"sourceUri": "ftp:/dir/source", "targetUri": "ftp:/dir/copy"}),
    )
    .unwrap();
    call(
        &p,
        "filesystem/rename",
        json!({"sourceUri": "ftp:/dir/copy", "targetUri": "ftp:/dir/moved"}),
    )
    .unwrap();
    assert_eq!(
        code(call(&p, "filesystem/delete", json!({"uri": "ftp:/dir"})).unwrap_err()),
        "directory_not_empty"
    );
    for name in ["source", "moved"] {
        call(
            &p,
            "filesystem/delete",
            json!({"uri": format!("ftp:/dir/{name}")}),
        )
        .unwrap();
    }
    call(&p, "filesystem/delete", json!({"uri": "ftp:/dir"})).unwrap();
}

#[test]
fn recursive_copy_delete_and_cross_connection_copy_rejected() {
    let (p, _) = memory(false);
    call(&p, "filesystem/createDirectory", json!({"uri": "ftp:/dir"})).unwrap();
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/copy",
                json!({"sourceUri": "ftp:/dir", "targetUri": "ftp:/other"})
            )
            .unwrap_err()
        ),
        "unsupported"
    );
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/delete",
                json!({"uri": "ftp:/dir", "recursive": true})
            )
            .unwrap_err()
        ),
        "unsupported"
    );
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/copy",
                json!({"sourceUri": "ftp:/a", "targetUri": "ftp:/b", "targetConnectionId": "other"})
            )
            .unwrap_err()
        ),
        "unsupported"
    );
}

#[test]
fn directory_rename_preserves_contents_and_rejects_overlap() {
    let (p, s) = memory(false);
    p.runtime.block_on(async {
        s.operator.create_dir("from/nested/").await.unwrap();
        s.operator
            .write("from/nested/file", "contents")
            .await
            .unwrap();
    });
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/rename",
                json!({"sourceUri": "ftp:/from", "targetUri": "ftp:/from/nested/other"})
            )
            .unwrap_err()
        ),
        "configuration"
    );
    call(
        &p,
        "filesystem/rename",
        json!({"sourceUri": "ftp:/from", "targetUri": "ftp:/to"}),
    )
    .unwrap();
    assert_eq!(
        call(&p, "filesystem/read", json!({"uri": "ftp:/to/nested/file"})).unwrap()["dataBase64"],
        STANDARD.encode(b"contents")
    );
    assert!(!p
        .runtime
        .block_on(s.operator.exists("from/nested/file"))
        .unwrap());
}

#[test]
fn listing_is_bounded_with_opaque_one_use_path_bound_cursors() {
    let (p, s) = memory(false);
    p.runtime.block_on(async {
        for i in 0..1005 {
            s.operator
                .write(&format!("file-{i:04}"), "x")
                .await
                .unwrap();
        }
    });
    let page = call(&p, "filesystem/list", json!({"limit": 5000})).unwrap();
    assert_eq!(page["entries"].as_array().unwrap().len(), 1000);
    let cursor = page["nextCursor"].as_str().unwrap();
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/list",
                json!({"uri": "ftp:/other/", "cursor": cursor})
            )
            .unwrap_err()
        ),
        "invalid_cursor"
    );
    let next = call(&p, "filesystem/list", json!({"cursor": cursor})).unwrap();
    assert_eq!(next["entries"].as_array().unwrap().len(), 5);
    assert!(next["nextCursor"].is_null());
    assert_eq!(
        code(call(&p, "filesystem/list", json!({"cursor": cursor})).unwrap_err()),
        "invalid_cursor"
    );
}

#[test]
fn write_validation_etag_and_empty_file() {
    let (p, _) = memory(false);
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/write",
                json!({"uri": "ftp:/missing", "dataBase64": "", "create": false})
            )
            .unwrap_err()
        ),
        "not_found"
    );
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/write",
                json!({"uri": "ftp:/missing", "dataBase64": "not-base64!"})
            )
            .unwrap_err()
        ),
        "configuration"
    );
    call(
        &p,
        "filesystem/write",
        json!({"uri": "ftp:/empty", "dataBase64": ""}),
    )
    .unwrap();
    assert_eq!(
        call(&p, "filesystem/read", json!({"uri": "ftp:/empty"})).unwrap()["dataBase64"],
        ""
    );
    assert_eq!(code(call(&p, "filesystem/write", json!({"uri": "ftp:/empty", "dataBase64": "", "overwrite": true, "etag": "unavailable"})).unwrap_err()), "unsupported");
}

#[test]
fn upload_download_full_snapshots_and_atomic_local_no_clobber() {
    let (p, _) = memory(false);
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let target = temp.path().join("target");
    let bytes = vec![42u8; operations::BUFFER_SIZE * 3 + 17];
    std::fs::write(&source, &bytes).unwrap();
    let started = call(
        &p,
        "filesystem/transfer/startUpload",
        json!({"uri": "ftp:/uploaded", "localPath": source}),
    )
    .unwrap();
    assert_eq!(started["state"], "queued");
    assert_eq!(started["direction"], "upload");
    assert!(started.get("localPath").is_none());
    let upload = wait_task(&p, started["transferId"].as_str().unwrap());
    assert_eq!(upload["state"], "completed", "{upload}");
    assert_eq!(upload["bytesTransferred"], bytes.len());
    for expected in ["completed", "failed"] {
        let start = call(
            &p,
            "filesystem/transfer/startDownload",
            json!({"uri": "ftp:/uploaded", "localPath": target}),
        )
        .unwrap();
        let task = wait_task(&p, start["transferId"].as_str().unwrap());
        assert_eq!(task["state"], expected, "{task}");
        assert_eq!(std::fs::read(&target).unwrap(), bytes);
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 2);
    let list = call(&p, "filesystem/transfer/list", json!({})).unwrap();
    assert_eq!(list["transfers"].as_array().unwrap().len(), 3);
    p.shutdown();
}

#[test]
fn queued_cancellation_and_timeout_have_distinct_terminal_states() {
    let (p, s) = memory(false);
    let _slots = p.runtime.block_on(s.permits.acquire_many(2)).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let target = temp.path().join("target");
    let start = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/missing", "localPath": target}),
    )
    .unwrap();
    let id = start["transferId"].as_str().unwrap();
    call(&p, "filesystem/transfer/cancel", json!({"transferId": id})).unwrap();
    assert_eq!(wait_task(&p, id)["state"], "cancelled");
    let start = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/missing", "localPath": target, "timeoutMs": 10}),
    )
    .unwrap();
    let status = wait_task(&p, start["transferId"].as_str().unwrap());
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"]["data"]["code"], "timeout");
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn host_leased_download_preserves_publication_and_echoes_only_lease_id() {
    let (p, s) = memory(false);
    p.runtime
        .block_on(s.operator.write("source", "payload"))
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    let directory = tempfile::Builder::new()
        .prefix(".dbx-download-lease-")
        .tempdir_in(root.path())
        .unwrap();
    let destination = root.path().join("destination");
    let id = uuid::Uuid::new_v4().to_string();
    for expected in ["completed", "failed"] {
        let start = call(
            &p,
            "filesystem/transfer/startDownload",
            json!({
                "uri": "ftp:/source", "localPath": destination,
                "hostDownloadLeaseId": id, "downloadTemporaryDirectory": directory.path()
            }),
        )
        .unwrap();
        assert_eq!(start["hostDownloadLeaseId"], id);
        assert!(start.get("downloadTemporaryDirectory").is_none());
        let status = wait_task(&p, start["transferId"].as_str().unwrap());
        assert_eq!(status["state"], expected);
        assert_eq!(status["hostDownloadLeaseId"], id);
        assert_eq!(std::fs::read(&destination).unwrap(), b"payload");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}

#[test]
fn uploads_waiting_on_mutation_lock_do_not_reserve_global_slots() {
    let (p, session) = memory(false);
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("source");
    std::fs::write(&source, b"payload").unwrap();
    let mutation = p.runtime.block_on(session.mutations.lock());
    let tasks: Vec<_> = (0..2)
        .map(|index| {
            call(
                &p,
                "filesystem/transfer/startUpload",
                json!({
                    "uri": format!("ftp:/target-{index}"), "localPath": source
                }),
            )
            .unwrap()
        })
        .collect();
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while session.permits.available_permits() != 0 {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    std::thread::sleep(Duration::from_millis(20));
    let available = p.transfers.global.available_permits();
    drop(mutation);
    for task in tasks {
        assert_eq!(
            wait_task(&p, task["transferId"].as_str().unwrap())["state"],
            "completed"
        );
    }
    assert_eq!(
        available, 8,
        "Waiting uploads reserved global transfer capacity"
    );
}

#[test]
fn host_download_lease_rejects_incomplete_or_out_of_parent_authority() {
    let (p, _) = memory(false);
    let root = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let directory = tempfile::Builder::new()
        .prefix(".dbx-download-lease-")
        .tempdir_in(other.path())
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    for fields in [
        json!({"hostDownloadLeaseId": id}),
        json!({"downloadTemporaryDirectory": directory.path()}),
        json!({"hostDownloadLeaseId": "not-a-uuid", "downloadTemporaryDirectory": directory.path()}),
        json!({"hostDownloadLeaseId": id, "downloadTemporaryDirectory": directory.path()}),
        json!({"hostDownloadLeaseId": id, "downloadTemporaryDirectory": root.path()}),
    ] {
        let mut params =
            json!({"uri": "ftp:/source", "localPath": root.path().join("destination")});
        params
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        assert_eq!(
            code(call(&p, "filesystem/transfer/startDownload", params).unwrap_err()),
            "configuration"
        );
    }
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[test]
fn host_leased_download_cancel_and_timeout_leave_only_the_empty_lease_directory() {
    for cancel in [true, false] {
        let p = Plugin::new().unwrap();
        let op = Operator::new(services::Memory::default()).unwrap().finish();
        p.runtime.block_on(op.write("source", "abc")).unwrap();
        let entered = Arc::new(AtomicBool::new(false));
        let s = Arc::new(Session::new(
            "test".into(),
            "ftp".into(),
            op.layer(SlowRead(entered.clone())),
            false,
        ));
        p.sessions.lock().unwrap().insert(s.id.clone(), s);
        let root = tempfile::tempdir().unwrap();
        let directory = tempfile::Builder::new()
            .prefix(".dbx-download-lease-")
            .tempdir_in(root.path())
            .unwrap();
        let target = root.path().join("destination");
        std::fs::write(&target, b"original").unwrap();
        let start = call(&p, "filesystem/transfer/startDownload", json!({
            "uri": "ftp:/source", "localPath": target, "overwrite": true,
            "timeoutMs": if cancel { 5000 } else { 200 },
            "hostDownloadLeaseId": uuid::Uuid::new_v4(), "downloadTemporaryDirectory": directory.path()
        })).unwrap();
        let id = start["transferId"].as_str().unwrap();
        let wait = std::time::Instant::now();
        while !entered.load(Ordering::SeqCst) {
            assert!(wait.elapsed() < Duration::from_secs(3));
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        if cancel {
            call(&p, "filesystem/transfer/cancel", json!({"transferId": id})).unwrap();
        }
        let status = wait_task(&p, id);
        assert_eq!(status["state"], if cancel { "cancelled" } else { "failed" });
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }
}

#[test]
fn absolute_paths_and_transfer_ownership_are_enforced() {
    let (p, _) = memory(false);
    for path in ["relative", "/tmp/../tmp/file", "/"] {
        assert_eq!(
            code(
                call(
                    &p,
                    "filesystem/transfer/startDownload",
                    json!({"uri": "ftp:/a", "localPath": path})
                )
                .unwrap_err()
            ),
            "configuration"
        );
    }
    let start = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/missing", "localPath": "/tmp/unused-dbx-test"}),
    )
    .unwrap();
    assert_eq!(
        code(
            call(
                &p,
                "filesystem/transfer/status",
                json!({"connectionId": "other", "transferId": start["transferId"]})
            )
            .unwrap_err()
        ),
        "not_found"
    );
    wait_task(&p, start["transferId"].as_str().unwrap());
}

#[test]
fn disconnect_closes_session_and_cancels_queued_transfers() {
    let (p, s) = memory(false);
    let _slots = p.runtime.block_on(s.permits.acquire_many(2)).unwrap();
    let start = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri": "ftp:/missing", "localPath": "/tmp/unused-dbx-test"}),
    )
    .unwrap();
    p.invoke("connection/disconnect", connection("ftp"), None)
        .unwrap();
    assert_eq!(
        wait_task(&p, start["transferId"].as_str().unwrap())["state"],
        "cancelled"
    );
    assert_eq!(
        code(call(&p, "filesystem/list", json!({})).unwrap_err()),
        "not_connected"
    );
}

#[derive(Debug, Clone)]
struct SlowRead(Arc<AtomicBool>);
#[derive(Debug)]
struct SlowAccessor<A> {
    inner: A,
    entered: Arc<AtomicBool>,
    delay_read: bool,
    deny_delete: bool,
    write_pause: Option<Arc<WritePause>>,
}
impl<A: opendal::raw::Access> opendal::raw::Layer<A> for SlowRead {
    type LayeredAccess = SlowAccessor<A>;
    fn layer(&self, inner: A) -> Self::LayeredAccess {
        SlowAccessor {
            inner,
            entered: self.0.clone(),
            delay_read: true,
            deny_delete: false,
            write_pause: None,
        }
    }
}
impl<A: opendal::raw::Access> opendal::raw::LayeredAccess for SlowAccessor<A> {
    type Inner = A;
    type Reader = A::Reader;
    type Writer = PausingWriter<A::Writer>;
    type Lister = A::Lister;
    type Deleter = A::Deleter;
    type Copier = A::Copier;
    fn inner(&self) -> &A {
        &self.inner
    }
    async fn read(
        &self,
        path: &str,
        args: opendal::raw::OpRead,
    ) -> opendal::Result<(opendal::raw::RpRead, Self::Reader)> {
        if self.delay_read {
            self.entered.store(true, Ordering::SeqCst);
            std::future::pending().await
        } else {
            self.inner.read(path, args).await
        }
    }
    async fn write(
        &self,
        path: &str,
        args: opendal::raw::OpWrite,
    ) -> opendal::Result<(opendal::raw::RpWrite, Self::Writer)> {
        let (reply, inner) = self.inner.write(path, args).await?;
        Ok((
            reply,
            PausingWriter {
                inner,
                pause: self.write_pause.clone(),
                written: 0,
            },
        ))
    }
    async fn list(
        &self,
        path: &str,
        args: opendal::raw::OpList,
    ) -> opendal::Result<(opendal::raw::RpList, Self::Lister)> {
        self.inner.list(path, args).await
    }
    async fn delete(&self) -> opendal::Result<(opendal::raw::RpDelete, Self::Deleter)> {
        if self.deny_delete {
            return Err(opendal::Error::new(
                opendal::ErrorKind::PermissionDenied,
                "Injected delete failure",
            ));
        }
        self.inner.delete().await
    }
    async fn copy(
        &self,
        from: &str,
        to: &str,
        args: opendal::raw::OpCopy,
        opts: opendal::raw::OpCopier,
    ) -> opendal::Result<(opendal::raw::RpCopy, Self::Copier)> {
        self.inner.copy(from, to, args, opts).await
    }
}

struct DenyDelete;
impl<A: opendal::raw::Access> opendal::raw::Layer<A> for DenyDelete {
    type LayeredAccess = SlowAccessor<A>;
    fn layer(&self, inner: A) -> Self::LayeredAccess {
        SlowAccessor {
            inner,
            entered: Arc::new(AtomicBool::new(false)),
            delay_read: false,
            deny_delete: true,
            write_pause: None,
        }
    }
}

#[derive(Debug, Default)]
struct WritePause {
    entered: AtomicBool,
    resumed: AtomicBool,
    closed: AtomicBool,
    aborted: AtomicBool,
    batches: Mutex<Vec<usize>>,
}

struct PauseWrites(Arc<WritePause>);

impl<A: opendal::raw::Access> opendal::raw::Layer<A> for PauseWrites {
    type LayeredAccess = SlowAccessor<A>;
    fn layer(&self, inner: A) -> Self::LayeredAccess {
        SlowAccessor {
            inner,
            entered: Arc::new(AtomicBool::new(false)),
            delay_read: false,
            deny_delete: false,
            write_pause: Some(self.0.clone()),
        }
    }
}

struct PausingWriter<W> {
    inner: W,
    pause: Option<Arc<WritePause>>,
    written: usize,
}

impl<W: opendal::raw::oio::Write> opendal::raw::oio::Write for PausingWriter<W> {
    async fn write(&mut self, buffer: opendal::Buffer) -> opendal::Result<()> {
        if let Some(pause) = &self.pause {
            // Acknowledge one buffer before stalling the next remote write.
            if self.written > 0 && !pause.resumed.load(Ordering::SeqCst) {
                pause.entered.store(true, Ordering::SeqCst);
                std::future::pending::<()>().await;
            }
        }
        let len = buffer.len();
        self.inner.write(buffer).await?;
        self.written += len;
        if let Some(pause) = &self.pause {
            pause.batches.lock().unwrap().push(len);
        }
        Ok(())
    }
    async fn close(&mut self) -> opendal::Result<opendal::Metadata> {
        if let Some(pause) = &self.pause {
            pause.closed.store(true, Ordering::SeqCst);
        }
        self.inner.close().await
    }
    async fn abort(&mut self) -> opendal::Result<()> {
        if let Some(pause) = &self.pause {
            pause.aborted.store(true, Ordering::SeqCst);
        }
        self.inner.abort().await
    }
}

#[test]
fn append_only_streams_batch_remote_writes_with_bounded_memory() {
    use opendal::raw::Access;
    let (p, original) = memory(false);
    let batch = 4 * 1024 * 1024;
    let payload = vec![42u8; 2 * batch + 37];
    p.runtime
        .block_on(original.operator.write("source", payload.clone()))
        .unwrap();
    let counter = Arc::new(WritePause::default());
    counter.resumed.store(true, Ordering::SeqCst);
    let op = original
        .operator
        .clone()
        .layer(PauseWrites(counter.clone()));
    // Model WebHDFS without an atomic-write directory: append works, multi-write/copy do not.
    op.inner().info().update_full_capability(|mut cap| {
        cap.write_can_multi = false;
        cap.write_can_append = true;
        cap.write_with_if_not_exists = false;
        cap.copy = false;
        cap
    });
    let session = Arc::new(Session::new("test".into(), "ftp".into(), op.clone(), false));
    p.sessions.lock().unwrap().insert("test".into(), session);
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    std::fs::write(&source, &payload).unwrap();
    let start = call(
        &p,
        "filesystem/transfer/startUpload",
        json!({
            "uri": "ftp:/upload", "localPath": source,
        }),
    )
    .unwrap();
    let status = wait_task(&p, start["transferId"].as_str().unwrap());
    assert_eq!(status["state"], "completed", "{status}");
    assert_eq!(
        p.runtime.block_on(op.read("upload")).unwrap().to_vec(),
        payload
    );
    // Memory has no native rename: publishing the upload also exercises the copy fallback.
    assert_eq!(
        *counter.batches.lock().unwrap(),
        [batch, batch, 37, 0, batch, batch, 37]
    );
    counter.batches.lock().unwrap().clear();
    p.runtime
        .block_on(operations::copy_file(&op, "source", "copy", false))
        .unwrap();
    assert_eq!(
        p.runtime.block_on(op.read("copy")).unwrap().to_vec(),
        payload
    );
    let batches: Vec<_> = counter
        .batches
        .lock()
        .unwrap()
        .iter()
        .copied()
        .filter(|n| *n > 0)
        .collect();
    assert_eq!(batches, [batch, batch, 37]);
}

#[test]
fn running_upload_interruption_cleans_temporary_preserves_target_and_allows_retry() {
    use opendal::raw::Access;
    for (protocol, append_only) in [("ftp", false), ("ftp", true), ("s3", false), ("s3", true)] {
        for cancel in [true, false] {
            let p = Plugin::new().unwrap();
            let op = Operator::new(services::Memory::default()).unwrap().finish();
            p.runtime.block_on(op.write("target", "original")).unwrap();
            if append_only {
                op.inner().info().update_full_capability(|mut cap| {
                    cap.write_can_multi = false;
                    cap.write_can_append = true;
                    cap.write_with_if_not_exists = false;
                    cap
                });
            }
            let pause = Arc::new(WritePause::default());
            let s = Arc::new(Session::new(
                "test".into(),
                protocol.into(),
                op.clone().layer(PauseWrites(pause.clone())),
                false,
            ));
            p.sessions.lock().unwrap().insert(s.id.clone(), s.clone());
            let dir = tempfile::tempdir().unwrap();
            let local = dir.path().join("source");
            let chunk = if append_only {
                operations::APPEND_CHUNK_SIZE
            } else {
                operations::BUFFER_SIZE
            };
            let payload = vec![42u8; chunk * 3];
            std::fs::write(&local, &payload).unwrap();
            let mut request = json!({
                "providerId": format!("{PLUGIN_ID}.{protocol}.files"),
                "connectionId": "test", "uri": format!("{protocol}:/target"),
                "localPath": local, "overwrite": true,
                "timeoutMs": if cancel { 5000 } else { 500 },
            });
            let start = p
                .invoke("filesystem/transfer/startUpload", request.clone(), None)
                .unwrap();
            request["transferId"] = start["transferId"].clone();
            let deadline = std::time::Instant::now() + Duration::from_secs(3);
            while !pause.entered.load(Ordering::SeqCst) {
                assert!(
                    std::time::Instant::now() < deadline,
                    "{protocol}: write was not reached"
                );
                std::thread::sleep(Duration::from_millis(1));
            }
            if cancel {
                p.invoke("filesystem/transfer/cancel", request.clone(), None)
                    .unwrap();
            }
            let status = loop {
                let status = p
                    .invoke("filesystem/transfer/status", request.clone(), None)
                    .unwrap();
                if status["state"] != "running" && status["state"] != "queued" {
                    break status;
                }
                assert!(std::time::Instant::now() < deadline, "{status}");
                std::thread::sleep(Duration::from_millis(5));
            };
            assert_eq!(
                status["state"],
                if cancel { "cancelled" } else { "failed" },
                "{status}"
            );
            assert_eq!(
                status["error"]["data"]["code"],
                if cancel { "cancelled" } else { "timeout" }
            );
            assert!(status["bytesTransferred"].as_u64().unwrap() > 0);
            assert!(status["bytesTransferred"].as_u64().unwrap() < payload.len() as u64);
            assert_eq!(pause.closed.load(Ordering::SeqCst), protocol == "ftp");
            assert_eq!(pause.aborted.load(Ordering::SeqCst), protocol != "ftp");
            assert_eq!(p.transfers.global.available_permits(), 8);
            assert_eq!(s.permits.available_permits(), 2);
            p.runtime.block_on(async {
                assert_eq!(op.read("target").await.unwrap().to_vec(), b"original");
                let entries = op.list("").await.unwrap();
                assert_eq!(entries.len(), 1, "Temporary upload leaked: {entries:?}");
                assert_eq!(entries[0].path(), "target");
            });
            pause.resumed.store(true, Ordering::SeqCst);
            request["timeoutMs"] = json!(5000);
            let retry = p
                .invoke("filesystem/transfer/startUpload", request.clone(), None)
                .unwrap();
            request["transferId"] = retry["transferId"].clone();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            loop {
                let status = p
                    .invoke("filesystem/transfer/status", request.clone(), None)
                    .unwrap();
                if status["state"] == "completed" {
                    break;
                }
                assert!(
                    status["state"] == "queued" || status["state"] == "running",
                    "{status}"
                );
                assert!(
                    std::time::Instant::now() < deadline,
                    "Retry did not complete: {status}"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            assert_eq!(
                p.runtime.block_on(op.read("target")).unwrap().to_vec(),
                payload
            );
            assert_eq!(p.runtime.block_on(op.list("")).unwrap().len(), 1);
            p.shutdown();
        }
    }
}

#[test]
fn partial_directory_rename_reports_recovery_and_keeps_source() {
    let (p, s) = memory(false);
    p.runtime.block_on(async {
        s.operator.create_dir("from/").await.unwrap();
        s.operator.write("from/file", "content").await.unwrap();
    });
    let faulty = Arc::new(Session::new(
        "test".into(),
        "ftp".into(),
        s.operator.clone().layer(DenyDelete),
        false,
    ));
    p.sessions.lock().unwrap().insert("test".into(), faulty);
    let e = call(
        &p,
        "filesystem/rename",
        json!({"sourceUri": "ftp:/from", "targetUri": "ftp:/to"}),
    )
    .unwrap_err();
    assert_eq!(e.data.as_ref().unwrap()["code"], "partial_rename");
    assert_eq!(
        e.data.unwrap()["recovery"]["action"],
        "inspect_both_locations"
    );
    for path in ["from/file", "to/file"] {
        assert_eq!(
            p.runtime.block_on(s.operator.read(path)).unwrap().to_vec(),
            b"content"
        );
    }
}

#[test]
fn upload_cleanup_failure_never_reports_completion_or_cancellation() {
    let (p, s) = memory(false);
    let faulty = Arc::new(Session::new(
        "test".into(),
        "ftp".into(),
        s.operator.clone().layer(DenyDelete),
        false,
    ));
    p.sessions.lock().unwrap().insert("test".into(), faulty);
    let dir = tempfile::tempdir().unwrap();
    let local = dir.path().join("source");
    std::fs::write(&local, b"content").unwrap();
    let task = call(
        &p,
        "filesystem/transfer/startUpload",
        json!({"uri": "ftp:/target", "localPath": local}),
    )
    .unwrap();
    let status = wait_task(&p, task["transferId"].as_str().unwrap());
    assert_eq!(status["state"], "failed");
    assert_eq!(status["error"]["data"]["code"], "cleanup_failed");
    assert_eq!(
        status["error"]["data"]["recovery"]["cleanupSucceeded"],
        false
    );
}

#[test]
fn transfer_limits_are_global_eight_and_per_connection_two() {
    let p = Plugin::new().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let mut requests = Vec::new();
    let mut sessions = Vec::new();
    for connection in 0..5 {
        let id = format!("limited-{connection}");
        let op = Operator::new(services::Memory::default()).unwrap().finish();
        p.runtime.block_on(op.write("source", "content")).unwrap();
        let s = Arc::new(Session::new(
            id.clone(),
            "ftp".into(),
            op.layer(SlowRead(Arc::new(AtomicBool::new(false)))),
            false,
        ));
        p.sessions.lock().unwrap().insert(id.clone(), s.clone());
        sessions.push(s);
        for index in 0..3 {
            let mut params = params();
            params["connectionId"] = json!(id);
            params["uri"] = json!("ftp:/source");
            params["localPath"] = json!(temp.path().join(format!("{connection}-{index}")));
            let start = p
                .invoke("filesystem/transfer/startDownload", params.clone(), None)
                .unwrap();
            params["transferId"] = start["transferId"].clone();
            requests.push(params);
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        let snapshots: Vec<_> = requests
            .iter()
            .map(|params| {
                p.transfers
                    .query("filesystem/transfer/status", params)
                    .unwrap()
            })
            .collect();
        let running = snapshots.iter().filter(|s| s["state"] == "running").count();
        assert!(running <= 8);
        for s in &sessions {
            assert!(
                snapshots
                    .iter()
                    .filter(|v| v["connectionId"] == s.id && v["state"] == "running")
                    .count()
                    <= 2
            );
        }
        if running == 8 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "Global transfer pool was not fully utilized"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(p.transfers.global.available_permits(), 0);
    p.shutdown();
    for params in requests {
        assert_eq!(
            p.transfers
                .query("filesystem/transfer/status", &params)
                .unwrap()["state"],
            "cancelled"
        );
    }
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    assert_eq!(p.transfers.global.available_permits(), 8);
}

#[test]
fn running_download_cancellation_and_timeout_remove_temporary_files() {
    for cancel in [true, false] {
        let p = Plugin::new().unwrap();
        let op = Operator::new(services::Memory::default()).unwrap().finish();
        p.runtime.block_on(op.write("source", "abc")).unwrap();
        let entered = Arc::new(AtomicBool::new(false));
        let s = Arc::new(Session::new(
            "test".into(),
            "ftp".into(),
            op.layer(SlowRead(entered.clone())),
            false,
        ));
        p.sessions.lock().unwrap().insert(s.id.clone(), s);
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("destination");
        let start = call(&p, "filesystem/transfer/startDownload", json!({"uri": "ftp:/source", "localPath": target, "timeoutMs": if cancel { 5000 } else { 100 }})).unwrap();
        let id = start["transferId"].as_str().unwrap();
        let wait = std::time::Instant::now();
        while !entered.load(Ordering::SeqCst) {
            assert!(wait.elapsed() < Duration::from_secs(3));
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
        if cancel {
            call(&p, "filesystem/transfer/cancel", json!({"transferId": id})).unwrap();
        }
        let task = wait_task(&p, id);
        assert_eq!(
            task["state"],
            if cancel { "cancelled" } else { "failed" },
            "{task}"
        );
        assert_eq!(
            task["error"]["data"]["code"],
            if cancel { "cancelled" } else { "timeout" }
        );
        assert!(!target.exists());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
}

#[test]
#[ignore = "Requires the disposable local S3 and WebDAV fixtures"]
fn live_native_listing_regression() {
    let p = Plugin::new().unwrap();
    p.runtime.block_on(async {
        for protocol in ["s3", "webdav"] {
            let mut config = connection(protocol);
            if protocol == "s3" {
                config["connection"]["connection_secrets"] =
                    json!({"access_key": "dbx-access-key", "secret_key": "dbx-secret-key"});
            } else {
                config["connection"]["external_config"]["endpoint"] =
                    json!("http://127.0.0.1:8080");
                config["connection"]["connection_secrets"] = json!({"password": "dbx-password"});
            }
            let op = ConnectionRequest::parse(config).unwrap().build().unwrap();
            let dir = format!("backend-regression-{}/", uuid::Uuid::new_v4());
            op.create_dir(&dir).await.unwrap();
            for file in ["a", "b", "c"] {
                op.write(&format!("{dir}{file}"), "x").await.unwrap();
            }
            let mut names = Vec::new();
            let session = Session::new("live".into(), protocol.into(), op.clone(), false);
            let mut params =
                json!({"uri": uri::uri(protocol, dir.trim_end_matches('/')), "limit": 1});
            for _ in 0..6 {
                let page = operations::dispatch(&session, "filesystem/list", &params)
                    .await
                    .unwrap();
                assert!(page["entries"].as_array().unwrap().len() <= 1);
                for e in page["entries"].as_array().unwrap() {
                    names.push(e["name"].as_str().unwrap().to_string());
                }
                if page["nextCursor"].is_null() {
                    break;
                }
                params["cursor"] = page["nextCursor"].clone();
            }
            for file in ["a", "b", "c"] {
                op.delete(&format!("{dir}{file}")).await.unwrap();
            }
            op.delete(&dir).await.unwrap();
            names.sort();
            assert_eq!(
                names,
                ["a", "b", "c"],
                "{protocol}: limit=1 dropped entries"
            );
        }
    });
}
