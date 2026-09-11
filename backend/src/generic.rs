use crate::error::{error, remote, Result};
use opendal::{Configurator, Operator};
use std::collections::HashMap;

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

/// Normalized OpenDAL configuration. Never derive Debug: values may contain credentials.
pub struct Configuration {
    pub service: String,
    pub parameters: HashMap<String, String>,
}

impl Configuration {
    pub fn build(self) -> Result<Operator> {
        let service = crate::service_support::check(&self.service)?;
        if let Some(root) = self.parameters.get("root") {
            if root.contains('\\')
                || root.chars().any(char::is_control)
                || root.split('/').any(|p| p == "." || p == "..")
            {
                return Err(error("configuration", "Invalid configured root"));
            }
        }
        build_operator(&service.scheme, self.parameters)
    }
}

#[cfg(test)]
pub fn build(id: &str, input: &str) -> Result<Operator> {
    Configuration {
        service: id.into(),
        parameters: parameters(input)?,
    }
    .build()
}

/// Construct every standard OpenDAL service from the normalized string map.
/// Connection-specific field conversion belongs at the configuration boundary.
fn build_operator(scheme: &str, parameters: HashMap<String, String>) -> Result<Operator> {
    let operator = match scheme {
        "hdfs-native" if parameters.contains_key("options") => {
            with_map::<opendal::services::HdfsNativeConfig>(&parameters, "options")?
        }
        "s3" if parameters.contains_key("assume_role_session_tags") => {
            with_map::<opendal::services::S3Config>(&parameters, "assume_role_session_tags")?
        }
        _ => Operator::via_iter(scheme, parameters.clone())
            .map_err(|e| crate::service_support::construction_error(scheme, e))?,
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

// OpenDAL 0.59's string-map deserializer does not implement nested maps. Keep
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
    Operator::from_config(config).map_err(remote)
}
