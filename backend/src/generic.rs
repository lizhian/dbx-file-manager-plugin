use crate::error::{error, remote, Result};
use opendal::{Configurator, Operator};
use serde::Deserialize;
use std::{collections::HashMap, sync::LazyLock};

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

pub fn parameters(input: &str) -> Result<HashMap<String, String>> {
    if input.len() > 256 * 1024 {
        return Err(error("configuration", "Parameters exceed 256 KiB"));
    }
    let mut result = HashMap::new();
    for (index, line) in input.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let invalid = |message| {
            error(
                "configuration",
                &format!("Parameter line {}: {message}", index + 1),
            )
        };
        let (key, value) = line.split_once('=').ok_or_else(|| invalid("missing ="))?;
        let key = key.trim();
        if key.is_empty() || key.chars().any(char::is_control) {
            return Err(invalid("invalid key"));
        }
        if result.insert(key.to_string(), value.to_string()).is_some() {
            return Err(invalid("duplicate key"));
        }
    }
    Ok(result)
}

pub fn build(id: &str, input: &str) -> Result<Operator> {
    let service = service(id)?;
    if service.status != "compiled" {
        return Err(error(
            "service_unavailable",
            &format!("{}: {}", service.id, service.reason),
        ));
    }
    let parameters = parameters(input)?;
    if let Some(root) = parameters.get("root") {
        if root.contains('\\')
            || root.chars().any(char::is_control)
            || root.split('/').any(|p| p == "." || p == "..")
        {
            return Err(error("configuration", "Invalid configured root"));
        }
    }
    opendal::init_default_registry();
    build_operator(&service.scheme, parameters)
}

/// Construct every standard OpenDAL service from the normalized string map.
/// Connection-specific field conversion belongs at the configuration boundary.
pub fn build_operator(scheme: &str, parameters: HashMap<String, String>) -> Result<Operator> {
    let operator = match scheme {
        "hdfs-native" if parameters.contains_key("options") => {
            with_map::<opendal::services::HdfsNativeConfig>(&parameters, "options")?
        }
        "s3" if parameters.contains_key("assume_role_session_tags") => {
            with_map::<opendal::services::S3Config>(&parameters, "assume_role_session_tags")?
        }
        _ => Operator::via_iter(scheme, parameters.clone()).map_err(remote)?,
    };
    // Reuse the existing streaming adapter at construction, keeping file operations generic.
    if scheme == "webdav" {
        let value = |key: &str, default: &str| {
            parameters
                .get(key)
                .cloned()
                .unwrap_or_else(|| default.into())
        };
        let layer = crate::webdav::StreamingLayer::new(
            &value("endpoint", ""),
            &value("root", "/"),
            &value("username", ""),
            &value("password", ""),
            parameters.get("token").map(String::as_str),
        )?;
        return Ok(operator.layer(layer));
    }
    Ok(operator)
}

// OpenDAL 0.57's string-map deserializer does not implement nested maps. Keep
// this version adapter at the configuration boundary; scalar types remain SDK-owned.
fn with_map<C>(parameters: &HashMap<String, String>, key: &str) -> Result<Operator>
where
    C: Configurator + serde::Serialize + serde::de::DeserializeOwned,
{
    let mut values = parameters.clone();
    let encoded = values.remove(key).expect("map field checked");
    let map: HashMap<String, String> = serde_json::from_str(&encoded).map_err(|_| {
        error(
            "configuration",
            "Map parameter must be a JSON object with string values",
        )
    })?;
    let config = C::from_iter(values).map_err(remote)?;
    let mut config = serde_json::to_value(config)
        .map_err(|_| error("configuration", "Cannot construct service configuration"))?;
    config[key] = serde_json::json!(map);
    let config: C = serde_json::from_value(config)
        .map_err(|_| error("configuration", "Invalid service configuration"))?;
    Operator::from_config(config)
        .map(|builder| builder.finish())
        .map_err(remote)
}
