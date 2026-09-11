use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use opendal::{raw::*, Operator};

fn connection(service: &str, parameters: &str) -> Value {
    json!({"provider":{"id":format!("{PLUGIN_ID}.opendal"),"databaseType":"opendal"},
        "connection":{"id":"generic-test","plugin_id":PLUGIN_ID,"plugin_connection_provider":format!("{PLUGIN_ID}.opendal"),
            "plugin_connection_type":"opendal","connection_secrets":{"service":service,"parameters":parameters}}})
}
fn call(p: &Plugin, method: &str, extra: Value) -> Value {
    let mut params =
        json!({"connectionId":"generic-test","providerId":format!("{PLUGIN_ID}.opendal.files")});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let result = p.invoke(method, params, None).unwrap();
    if method.starts_with("workbench/") {
        assert_eq!(result["ok"], true, "{method}: {result}");
        result["value"].clone()
    } else {
        result
    }
}

#[test]
fn generic_parameters_preserve_values_and_never_echo_secrets() {
    let values = generic::parameters(" key = value = secret \r\nempty=\r\n\n中文=测试\n").unwrap();
    assert_eq!(values["key"], " value = secret ");
    assert_eq!(values["empty"], "");
    assert_eq!(values["中文"], "测试");
    for input in [
        "sensitive-secret",
        "=sensitive-secret",
        "a=first\na=sensitive-secret",
    ] {
        let e = generic::parameters(input).unwrap_err();
        assert!(!format!("{e:?}").contains("sensitive-secret"));
        assert!(e.message.contains("line"));
    }
    let mut request = connection("memory", "");
    request["connection"]["connection_secrets"] = json!({});
    request["connection"]["external_config"] =
        json!({"service":"memory","parameters":"password=sensitive-secret"});
    assert!(ConnectionRequest::parse(request).unwrap().build().is_err());
    for s in generic::SERVICES.iter().filter(|s| s.status != "compiled") {
        let e = generic::build(&s.id, "password=sensitive-secret").unwrap_err();
        assert_eq!(e.data.unwrap()["code"], "service_unavailable");
        assert!(!e.message.contains("sensitive-secret"));
    }
}

#[test]
fn generic_map_configurations_are_typed_and_redacted() {
    assert!(generic::build(
        "s3",
        "bucket=test\nregion=us-east-1\nassume_role_session_tags={\"name\":\"value\"}"
    )
    .is_ok());
    assert!(generic::build(
        "hdfs-native",
        "name_node=hdfs://127.0.0.1:19000\noptions={\"dfs.client.use.datanode.hostname\":\"true\"}"
    )
    .is_ok());
    for value in ["secret-invalid-json", "{\"secret\":123}"] {
        let error = generic::build(
            "s3",
            &format!("bucket=test\nassume_role_session_tags={value}"),
        )
        .unwrap_err();
        assert!(!format!("{error:?}").contains(value));
    }
}

#[test]
fn generic_catalog_compiled_schemes_are_registered() {
    let p = Plugin::new().unwrap();
    let _runtime = p.runtime.enter();
    opendal::init_default_registry();
    let dir = tempfile::tempdir().unwrap();
    for service in generic::SERVICES.iter().filter(|s| s.status == "compiled") {
        let root = dir.path().join(&service.id);
        std::fs::create_dir(&root).unwrap();
        let result = Operator::via_iter(
            &service.scheme,
            [("root".into(), root.to_str().unwrap().into())],
        );
        if let Err(e) = result {
            assert!(
                !e.message().contains("scheme is not registered"),
                "{} missing registration",
                service.id
            );
        }
    }
}

#[test]
fn generic_memory_and_fs_use_shared_file_operations() {
    let directory = tempfile::tempdir().unwrap();
    for (service, parameters) in [
        ("memory", String::new()),
        ("fs", format!("root={}", directory.path().display())),
    ] {
        let p = Plugin::new().unwrap();
        let c = connection(service, &parameters);
        assert_eq!(
            p.invoke("connection/connect", c.clone(), None).unwrap()["verification"],
            "verified"
        );
        assert_eq!(
            call(&p, "workbench/capabilities", json!({}))["service"],
            service
        );
        call(
            &p,
            "workbench/createDirectory",
            json!({"uri":"opendal:/folder"}),
        );
        call(
            &p,
            "filesystem/write",
            json!({"uri":"opendal:/folder/hello.txt","dataBase64":STANDARD.encode("hello")}),
        );
        let preview = call(
            &p,
            "workbench/preview",
            json!({"uri":"opendal:/folder/hello.txt"}),
        );
        assert_eq!(preview["editable"], true);
        call(
            &p,
            "workbench/rename",
            json!({"sourceUri":"opendal:/folder/hello.txt","targetUri":"opendal:/folder/new.txt"}),
        );
        call(
            &p,
            "workbench/copy",
            json!({"sourceUri":"opendal:/folder/new.txt","targetUri":"opendal:/folder/copy.txt"}),
        );
        assert_eq!(
            call(
                &p,
                "workbench/list",
                json!({"uri":"opendal:/folder/","limit":200})
            )["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        for name in ["new.txt", "copy.txt"] {
            call(
                &p,
                "workbench/delete",
                json!({"uri":format!("opendal:/folder/{name}")}),
            );
        }
        call(&p, "workbench/delete", json!({"uri":"opendal:/folder"}));
        let denied = p.invoke("workbench/preview", json!({"connectionId":"generic-test","providerId":format!("{PLUGIN_ID}.opendal.files"),"uri":"opendal:/../outside"}), None).unwrap();
        assert_eq!(denied["error"]["details"]["code"], "configuration");
        p.invoke("connection/disconnect", c, None).unwrap();
        p.shutdown();
    }
}

#[derive(Debug, Clone)]
struct ReadOnly;

#[test]
fn generic_read_only_errors_are_distinct_from_missing_capabilities() {
    let session = session::Session::new(
        "read-only-test".into(), generic::build("memory", "").unwrap(),
        true,
    );
    for capability in [
        "write", "mkdir", "delete", "copy", "rename", "upload", "edit",
    ] {
        let err = operations::require(&session, capability).unwrap_err();
        assert_eq!(err.data.unwrap()["code"], "read_only");
    }
    operations::require(&session, "read").unwrap();
}
#[derive(Debug)]
struct ReadOnlyAccess<A: Access> {
    inner: A,
}
impl<A: Access> Layer<A> for ReadOnly {
    type LayeredAccess = ReadOnlyAccess<A>;
    fn layer(&self, inner: A) -> Self::LayeredAccess {
        ReadOnlyAccess { inner }
    }
}
impl<A: Access> LayeredAccess for ReadOnlyAccess<A> {
    type Inner = A;
    type Reader = A::Reader;
    type Writer = A::Writer;
    type Lister = A::Lister;
    type Deleter = A::Deleter;
    type Copier = A::Copier;
    fn inner(&self) -> &A {
        &self.inner
    }
    fn info(&self) -> Arc<AccessorInfo> {
        let info = AccessorInfo::default();
        info.set_scheme("http")
            .set_native_capability(opendal::Capability {
                read: true,
                ..Default::default()
            });
        Arc::new(info)
    }
    async fn read(&self, path: &str, args: OpRead) -> opendal::Result<(RpRead, Self::Reader)> {
        self.inner.read(path, args).await
    }
    async fn stat(&self, _: &str, _: OpStat) -> opendal::Result<RpStat> {
        panic!("stat must not be called")
    }
    async fn write(&self, _: &str, _: OpWrite) -> opendal::Result<(RpWrite, Self::Writer)> {
        panic!("write must not be called")
    }
    async fn delete(&self) -> opendal::Result<(RpDelete, Self::Deleter)> {
        panic!("delete must not be called")
    }
    async fn list(&self, _: &str, _: OpList) -> opendal::Result<(RpList, Self::Lister)> {
        panic!("list must not be called")
    }
}

#[test]
fn generic_statless_preview_download_and_capability_guards() {
    let p = Plugin::new().unwrap();
    let op = generic::build("memory", "").unwrap();
    p.runtime
        .block_on(op.write("known.txt", "known content"))
        .unwrap();
    let op = op.layer(ReadOnly);
    *p.operator_factory.lock().unwrap() = Some(Arc::new(move |_| Ok(op.clone())));
    let c = connection("http", "endpoint=http://127.0.0.1");
    let result = p.invoke("connection/connect", c, None).unwrap();
    assert_eq!(result["verification"], "configuration_only");
    let cap = call(&p, "workbench/capabilities", json!({}));
    assert_eq!(cap["read"], true);
    assert_eq!(cap["list"], false);
    assert_eq!(cap["upload"], false);
    let preview = call(&p, "workbench/preview", json!({"uri":"opendal:/known.txt"}));
    assert_eq!(preview["editable"], false);
    assert_eq!(
        call(
            &p,
            "workbench/previewChunk",
            json!({"token":preview["token"],"offset":0})
        )["dataBase64"],
        STANDARD.encode("known content")
    );
    for method in ["stageText", "saveText", "list", "createDirectory"] {
        let response = p.invoke(&format!("workbench/{method}"), json!({"connectionId":"generic-test","providerId":format!("{PLUGIN_ID}.opendal.files"),"uri":"opendal:/", "token":preview["token"]}), None).unwrap();
        assert_eq!(response["error"]["details"]["code"], "unsupported");
    }
    let local = tempfile::tempdir().unwrap();
    let target = local.path().join("download.txt");
    let task = call(
        &p,
        "filesystem/transfer/startDownload",
        json!({"uri":"opendal:/known.txt","localPath":target}),
    );
    let start = std::time::Instant::now();
    loop {
        let status = call(
            &p,
            "workbench/transfer/status",
            json!({"transferId":task["transferId"]}),
        );
        assert_ne!(status["state"], "failed", "{status}");
        if status["state"] == "completed" {
            assert!(status["totalBytes"].is_null());
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(10));
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(std::fs::read_to_string(target).unwrap(), "known content");
    assert_eq!(std::fs::read_dir(local.path()).unwrap().count(), 1);
    p.shutdown();
}
