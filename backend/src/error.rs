use dbx_plugin_sdk::PluginError;
use serde_json::{json, Value};

pub type Result<T> = std::result::Result<T, PluginError>;

pub fn error(code: &str, message: &str) -> PluginError {
    PluginError {
        code: if code == "configuration" {
            -32602
        } else {
            -32000
        },
        message: message.into(),
        data: Some(json!({"code": code})),
    }
}

pub fn recovery(mut error: PluginError, details: Value) -> PluginError {
    error.data.as_mut().unwrap()["recovery"] = details;
    error
}

pub fn remote(err: opendal::Error) -> PluginError {
    use opendal::ErrorKind::*;
    let (code, message) = match err.kind() {
        ConfigInvalid => ("configuration", "The remote configuration is invalid"),
        NotFound => ("not_found", "The requested entry does not exist"),
        PermissionDenied => ("permission_denied", "Permission was denied"),
        AlreadyExists | ConditionNotMatch => (
            "already_exists",
            "The destination exists or its condition changed",
        ),
        Unsupported => (
            "unsupported",
            "The remote service does not support this operation",
        ),
        RateLimited => ("rate_limited", "The remote service rate limit was reached"),
        _ => ("backend", "The remote file operation failed"),
    };
    // Do not expose OpenDAL errors: their contexts can contain endpoints and credentials.
    error(code, message)
}

pub fn text<'a>(params: &'a Value, key: &str) -> Result<&'a str> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| error("configuration", &format!("Missing or invalid {key}")))
}

pub fn flag(params: &Value, key: &str, default: bool) -> Result<bool> {
    match params.get(key).filter(|v| !v.is_null()) {
        None => Ok(default),
        Some(v) => v
            .as_bool()
            .ok_or_else(|| error("configuration", &format!("{key} must be a boolean"))),
    }
}

pub fn number(params: &Value, key: &str, default: u64, max: u64) -> Result<u64> {
    let value = match params.get(key).filter(|v| !v.is_null()) {
        None => default,
        Some(v) => v.as_u64().ok_or_else(|| {
            error(
                "configuration",
                &format!("{key} must be a positive integer"),
            )
        })?,
    };
    if value == 0 {
        return Err(error("configuration", &format!("{key} must be positive")));
    }
    Ok(value.min(max))
}
