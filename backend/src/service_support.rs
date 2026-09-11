use crate::error::{error, Result};
use serde::Deserialize;
use std::{
    ffi::OsStr,
    process::{Command, Stdio},
    sync::LazyLock,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
pub struct Service {
    pub id: String,
    pub scheme: String,
    pub status: String,
    pub reason: String,
}
#[derive(Deserialize)]
struct Catalog {
    services: Vec<Service>,
}
pub static SERVICES: LazyLock<Vec<Service>> = LazyLock::new(|| {
    serde_json::from_str::<Catalog>(include_str!("../../services.json"))
        .expect("validated service catalog")
        .services
});

pub fn service(id: &str) -> Result<&'static Service> {
    SERVICES
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| error("configuration", "Unknown OpenDAL service"))
}

fn unavailable(service: &str, reason: &str, message: &str) -> dbx_plugin_sdk::PluginError {
    let mut e = error("service_unavailable", message);
    e.data.as_mut().unwrap()["service"] = serde_json::json!(service);
    e.data.as_mut().unwrap()["reason"] = serde_json::json!(reason);
    e
}

pub fn check(id: &str) -> Result<&'static Service> {
    let service = service(id)?;
    check_build(service, cfg!(unix), cfg!(target_os = "linux"))?;
    if id == "sftp" {
        probe_ssh(OsStr::new("ssh"), Duration::from_secs(2))?;
    }
    opendal::install_default();
    if !opendal::OperatorRegistry::get()
        .schemes()
        .contains(&service.scheme)
    {
        return Err(unavailable(
            id,
            "unregistered",
            &format!("{}：当前安装包未注册该 OpenDAL 服务。", id),
        ));
    }
    Ok(service)
}

fn check_build(service: &Service, unix: bool, linux: bool) -> Result<()> {
    if service.id == "sftp" && !unix {
        return Err(unavailable(
            &service.id,
            "platform",
            "当前平台不支持 SFTP，需要 macOS 或 Linux 和系统 OpenSSH。",
        ));
    }
    let (reason, label) = match service.status.as_str() {
        "compiled" => return Ok(()),
        "platform" if linux && matches!(service.id.as_str(), "compfs" | "monoiofs") => {
            ("dependency", "此安装包未包含该服务")
        }
        "platform" => ("platform", "当前平台不支持该服务"),
        "dependency" => ("dependency", "此安装包未包含所需依赖"),
        "version" => ("version", "当前 OpenDAL 版本不提供该服务"),
        _ => ("unregistered", "此安装包未注册该服务"),
    };
    let message = if service.status == "platform" && reason == "dependency" {
        format!("{}：{}。", service.id, label)
    } else {
        format!("{}：{}；{}。", service.id, label, service.reason)
    };
    Err(unavailable(&service.id, reason, &message))
}

fn probe_ssh(executable: &OsStr, timeout: Duration) -> Result<()> {
    let failure = |detail: &str, message: &str| {
        let mut e = unavailable("sftp", "runtime_dependency", message);
        e.data.as_mut().unwrap()["dependency"] = serde_json::json!("OpenSSH");
        e.data.as_mut().unwrap()["detail"] = serde_json::json!(detail);
        e
    };
    let mut child = Command::new(executable)
        .arg("-V")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => failure(
                "missing",
                "SFTP 需要系统 OpenSSH：当前进程的 PATH 中未找到 ssh。",
            ),
            std::io::ErrorKind::PermissionDenied => failure(
                "not_executable",
                "SFTP 所需的 ssh 不可执行，请检查程序权限。",
            ),
            _ => failure("failed", "无法启动 SFTP 所需的系统 OpenSSH。"),
        })?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                return Err(failure(
                    "failed",
                    "系统 OpenSSH 检查失败：ssh -V 未成功退出。",
                ))
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(10)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if result.is_err() {
                    failure("failed", "无法读取系统 OpenSSH 的检查结果。")
                } else {
                    failure("timeout", "系统 OpenSSH 检查超时（ssh -V）。")
                });
            }
        }
    }
}

pub fn construction_error(service: &str, e: opendal::Error) -> dbx_plugin_sdk::PluginError {
    if e.kind() == opendal::ErrorKind::Unsupported && e.message() == "scheme is not registered" {
        unavailable(
            service,
            "unregistered",
            &format!("{}：当前安装包未注册该 OpenDAL 服务。", service),
        )
    } else {
        crate::error::remote(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_support_distinguishes_platform_package_and_version() {
        for (id, reason) in [("opfs", "platform"), ("hdfs", "dependency")] {
            let error = check_build(service(id).unwrap(), true, false).unwrap_err();
            assert_eq!(error.data.as_ref().unwrap()["code"], "service_unavailable");
            assert_eq!(error.data.unwrap()["reason"], reason);
        }
        let future = Service {
            id: "future-service".into(),
            scheme: "future-service".into(),
            status: "version".into(),
            reason: "当前版本未提供".into(),
        };
        assert_eq!(
            check_build(&future, true, false).unwrap_err().data.unwrap()["reason"],
            "version"
        );
        assert!(check_build(service("hdfs-native").unwrap(), true, false).is_ok());
        assert_eq!(
            check_build(service("sftp").unwrap(), false, false)
                .unwrap_err()
                .data
                .unwrap()["reason"],
            "platform"
        );
        assert_eq!(
            check_build(service("compfs").unwrap(), true, true)
                .unwrap_err()
                .data
                .unwrap()["reason"],
            "dependency"
        );
    }

    #[test]
    fn registry_rejection_is_distinct_from_configuration_and_authentication() {
        let error =
            opendal::Operator::via_iter("dbx-unregistered-test", Vec::<(String, String)>::new())
                .unwrap_err();
        assert_eq!(
            construction_error("dbx-unregistered-test", error)
                .data
                .unwrap()["reason"],
            "unregistered"
        );
        for (kind, code) in [
            (opendal::ErrorKind::PermissionDenied, "permission_denied"),
            (opendal::ErrorKind::ConfigInvalid, "configuration"),
        ] {
            let error = construction_error("s3", opendal::Error::new(kind, "sensitive-test-value"));
            assert_eq!(error.data.as_ref().unwrap()["code"], code);
            assert!(!error.message.contains("sensitive-test-value"));
        }
        assert_eq!(
            service("unknown-service").err().unwrap().data.unwrap()["code"],
            "configuration"
        );
    }

    #[cfg(unix)]
    #[test]
    fn ssh_probe_handles_missing_permissions_failure_timeout_and_success() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("ssh");
        let probe = || probe_ssh(executable.as_os_str(), Duration::from_secs(2));
        assert_eq!(probe().unwrap_err().data.unwrap()["detail"], "missing");
        std::fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            probe().unwrap_err().data.unwrap()["detail"],
            "not_executable"
        );
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        probe().unwrap();
        std::fs::write(
            &executable,
            "#!/bin/sh\necho sensitive-test-value >&2\nexit 1\n",
        )
        .unwrap();
        let error = probe().unwrap_err();
        assert_eq!(error.data.unwrap()["detail"], "failed");
        assert!(!error.message.contains("sensitive-test-value"));
        std::fs::write(&executable, "#!/bin/sh\nexec /bin/sleep 10\n").unwrap();
        let start = Instant::now();
        assert_eq!(
            probe_ssh(executable.as_os_str(), Duration::from_millis(80))
                .unwrap_err()
                .data
                .unwrap()["detail"],
            "timeout"
        );
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
