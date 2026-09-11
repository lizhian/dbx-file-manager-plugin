use crate::error::{error, flag, text, Result};
use crate::generic::{parameters, Configuration};
use opendal::Operator;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, path::Path};

pub const PLUGIN_ID: &str = "io.github.lizhian.file-manager";
pub const PROTOCOLS: [&str; 6] = ["ftp", "sftp", "s3", "webdav", "webhdfs", "hdfs-native"];

#[derive(Deserialize)]
pub struct ConnectionRequest {
    pub provider: Provider,
    pub connection: Connection,
    pub runtime: Option<Endpoint>,
    #[serde(skip)]
    pub fingerprint: [u8; 32],
}
#[derive(Deserialize)]
pub struct Provider {
    pub id: String,
    #[serde(rename = "databaseType")]
    pub database_type: String,
}
#[derive(Deserialize)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}
#[derive(Deserialize)]
pub struct Connection {
    pub id: String,
    pub plugin_id: String,
    pub plugin_connection_provider: String,
    pub plugin_connection_type: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub external_config: Value,
    #[serde(default)]
    pub connection_secrets: HashMap<String, String>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

impl ConnectionRequest {
    pub fn parse(mut value: Value) -> Result<Self> {
        value.sort_all_objects();
        let fingerprint = Sha256::digest(
            serde_json::to_vec(&value)
                .map_err(|_| error("configuration", "Invalid connection request"))?,
        )
        .into();
        let mut request: Self = serde_json::from_value(value)
            .map_err(|_| error("configuration", "Invalid connection request"))?;
        // Host c26ff3f clears external_config on form submit. Secret bindings survive
        // that path; keep accepting legacy external_config for existing connections.
        let keys = [
            "root",
            "authentication",
            "endpoint",
            "region",
            "bucket",
            "path_style",
            "use_delegation_token",
            "simple_user",
            "name_node_uri",
            "hadoop_config_directory",
        ];
        for key in keys {
            if let Some(value) = request.connection.connection_secrets.get(key) {
                let value = if matches!(key, "path_style" | "use_delegation_token") {
                    match value.as_str() {
                        "true" => Value::Bool(true),
                        "false" => Value::Bool(false),
                        _ => return Err(error("configuration", "Invalid boolean configuration")),
                    }
                } else {
                    Value::String(value.clone())
                };
                if !request.connection.external_config.is_object() {
                    request.connection.external_config = serde_json::json!({});
                }
                request.connection.external_config[key] = value;
            }
        }
        request.fingerprint = fingerprint;
        request.protocol()?;
        request.query_timeout()?;
        request.idle_timeout()?;
        Ok(request)
    }

    fn seconds(&self, key: &str, default: u64) -> Result<std::time::Duration> {
        let seconds = match self.connection.extra.get(key) {
            None => default,
            Some(value) => value.as_u64().ok_or_else(|| {
                error(
                    "configuration",
                    &format!("{key} must be a nonnegative integer"),
                )
            })?,
        };
        let duration = std::time::Duration::from_secs(seconds);
        if std::time::Instant::now().checked_add(duration).is_none() {
            return Err(error("configuration", "Timeout is too large"));
        }
        Ok(duration)
    }

    pub fn query_timeout(&self) -> Result<Option<std::time::Duration>> {
        let duration = self.seconds("query_timeout_secs", 60)?;
        Ok((!duration.is_zero()).then_some(duration))
    }

    pub fn idle_timeout(&self) -> Result<std::time::Duration> {
        self.seconds("idle_timeout_secs", 60)
    }

    pub fn protocol(&self) -> Result<&str> {
        let protocol = self
            .provider
            .id
            .strip_prefix(&format!("{PLUGIN_ID}."))
            .filter(|p| PROTOCOLS.contains(p) || *p == "opendal")
            .ok_or_else(|| error("configuration", "Unknown connection provider"))?;
        let c = &self.connection;
        if c.id.trim().is_empty()
            || c.plugin_id != PLUGIN_ID
            || c.plugin_connection_provider != self.provider.id
            || c.plugin_connection_type != self.provider.database_type
            || c.plugin_connection_type != protocol
        {
            return Err(error(
                "configuration",
                "Connection binding does not match the provider",
            ));
        }
        Ok(protocol)
    }

    pub fn build(&self) -> Result<Operator> {
        self.normalize()?.build()
    }

    pub fn normalize(&self) -> Result<Configuration> {
        let protocol = self.protocol()?;
        let c = &self.connection;
        let config = &c.external_config;
        if protocol == "opendal" {
            let service = c
                .connection_secrets
                .get("service")
                .ok_or_else(|| error("configuration", "Missing secret-bound service"))?;
            // Generic options are never read from ordinary configuration or exposed in errors.
            return Ok(Configuration {
                service: service.clone(),
                parameters: parameters(
                    c.connection_secrets
                        .get("parameters")
                        .map(String::as_str)
                        .unwrap_or(""),
                )?,
            });
        }

        if !config.is_object() && !config.is_null() {
            return Err(error("configuration", "external_config must be an object"));
        }
        let optional = |key: &str, default: &str| -> Result<String> {
            match config.get(key).filter(|v| !v.is_null()) {
                None => Ok(default.into()),
                Some(v) => v
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| error("configuration", &format!("{key} must be a string"))),
            }
        };
        let secret = |key: &str| -> &str {
            c.connection_secrets
                .get(key)
                .map(String::as_str)
                .or_else(|| {
                    if key == "password" {
                        c.password.as_deref()
                    } else {
                        None
                    }
                })
                .unwrap_or("")
        };
        let required_secret = |key| -> Result<&str> {
            let value = secret(key);
            if value.is_empty() {
                Err(error("configuration", &format!("{key} is required")))
            } else {
                Ok(value)
            }
        };
        let root = optional("root", "/")?;
        let overridden = self
            .runtime
            .as_ref()
            .is_some_and(|e| e.host != c.host || e.port != c.port);
        let transport = c
            .extra
            .get("ssh_tunnel")
            .is_some_and(|v| v["enabled"] == true)
            || c.extra.get("proxy").is_some_and(|v| v["enabled"] == true)
            || c.extra
                .get("ssh_tunnels")
                .and_then(Value::as_array)
                .is_some_and(|v| v.iter().any(|v| v["enabled"] == true))
            || c.extra
                .get("transport_layers")
                .and_then(Value::as_array)
                .is_some_and(|v| {
                    v.iter()
                        .any(|v| v.get("enabled").and_then(Value::as_bool).unwrap_or(true))
                });
        if !matches!(protocol, "ftp" | "sftp") && (overridden || transport) {
            return Err(error(
                "unsupported",
                "This protocol does not support SSH or proxy transport layers",
            ));
        }
        let mut values = HashMap::from([("root".to_owned(), root)]);
        let mut set = |key: &str, value: &str| {
            values.insert(key.into(), value.into());
        };
        match protocol {
            "ftp" | "sftp" => {
                let host = self
                    .runtime
                    .as_ref()
                    .map(|r| r.host.as_str())
                    .unwrap_or(&c.host);
                let port = self.runtime.as_ref().map(|r| r.port).unwrap_or(c.port);
                let fallback = optional("endpoint", "")?;
                let host = if host.is_empty() { &fallback } else { host };
                let scheme = if protocol == "ftp" { "ftp" } else { "ssh" };
                let port = if port == 0 {
                    if protocol == "ftp" {
                        21
                    } else {
                        22
                    }
                } else {
                    port
                };
                set("endpoint", &tcp_endpoint(host, scheme, port)?);
                set("user", &c.username);
                if protocol == "ftp" {
                    set("password", secret("password"));
                } else {
                    {
                        set("known_hosts_strategy", "Accept");
                        match optional("authentication", "ssh_config")?.as_str() {
                            "ssh_config" | "ssh_agent" => {},
                            "private_key" => {
                                let key = required_secret("private_key")?;
                                if !Path::new(key).is_absolute() {
                                    return Err(error("configuration", "SFTP private_key must be an absolute OpenSSH key-file path"));
                                }
                                set("key", key);
                            },
                            _ => return Err(error("unsupported", "SFTP supports ssh_config, ssh_agent and private_key; password authentication is not supported")),
                        }
                    }
                }
            }
            "s3" => {
                for key in ["endpoint", "region", "bucket"] {
                    set(key, text(config, key)?);
                }
                set("access_key_id", required_secret("access_key")?);
                set("secret_access_key", required_secret("secret_key")?);
                set("disable_config_load", "true");
                set("disable_ec2_metadata", "true");
                set(
                    "enable_virtual_host_style",
                    if flag(config, "path_style", true)? {
                        "false"
                    } else {
                        "true"
                    },
                );
                if !secret("session_token").is_empty() {
                    set("session_token", secret("session_token"));
                }
            }
            "webdav" => {
                set("endpoint", text(config, "endpoint")?);
                match optional("authentication", "basic")?.as_str() {
                    "basic" => {
                        if c.username.is_empty() {
                            return Err(error("configuration", "WebDAV username is required"));
                        }
                        set("username", &c.username);
                        set("password", required_secret("password")?);
                    }
                    "bearer" => set("token", required_secret("bearer_token")?),
                    _ => {
                        return Err(error(
                            "configuration",
                            "WebDAV authentication must be basic or bearer",
                        ))
                    }
                }
            }
            "webhdfs" => {
                set("endpoint", text(config, "endpoint")?);
                if flag(config, "use_delegation_token", false)? {
                    set("delegation", required_secret("delegation_token")?);
                } else {
                    set("user_name", text(config, "simple_user")?);
                }
            }
            "hdfs-native" => {
                let node = text(config, "name_node_uri")?;
                if !node.strip_prefix("hdfs://").is_some_and(|s| {
                    let s = s.trim_end_matches('/');
                    !s.is_empty()
                        && !s.contains(['/', '?', '#', '@'])
                        && !s.chars().any(char::is_whitespace)
                        && s.split(',').all(|s| !s.is_empty())
                }) {
                    return Err(error(
                        "configuration",
                        "NameNode URI must have an hdfs:// authority",
                    ));
                }
                set("name_node", node);
                let options = hadoop_options(text(config, "hadoop_config_directory")?)?;
                set(
                    "options",
                    &serde_json::to_string(&options)
                        .map_err(|_| error("configuration", "Invalid Hadoop options"))?,
                );
            }
            _ => unreachable!(),
        }
        Ok(Configuration {
            service: protocol.into(),
            parameters: values,
        })
    }
}

fn tcp_endpoint(host: &str, scheme: &str, port: u16) -> Result<String> {
    if host.trim().is_empty() {
        return Err(error("configuration", "Host is required"));
    }
    let authority = if host.contains("://") {
        host.into()
    } else if host.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("{scheme}://[{host}]")
    } else {
        format!("{scheme}://{host}")
    };
    let mut url =
        url::Url::parse(&authority).map_err(|_| error("configuration", "Invalid endpoint"))?;
    if url.scheme() != scheme
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(error("configuration", "Invalid TCP endpoint"));
    }
    url.set_port(Some(port))
        .map_err(|_| error("configuration", "Invalid port"))?;
    Ok(url.to_string().trim_end_matches('/').into())
}

fn hadoop_options(directory: &str) -> Result<HashMap<String, String>> {
    let directory = Path::new(directory);
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(error(
            "configuration",
            "Hadoop config directory must be an accessible absolute directory",
        ));
    }
    let mut options = HashMap::new();
    let mut loaded = false;
    for name in ["core-site.xml", "hdfs-site.xml"] {
        let file = match std::fs::File::open(directory.join(name)) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                return Err(error(
                    "configuration",
                    "Hadoop configuration is inaccessible",
                ))
            }
        };
        if !file
            .metadata()
            .map_err(|_| error("configuration", "Cannot inspect Hadoop config"))?
            .is_file()
        {
            return Err(error(
                "configuration",
                "Hadoop config must be a regular file",
            ));
        }
        let mut bytes = Vec::new();
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| error("configuration", "Cannot read Hadoop config"))?;
        if bytes.len() > 1024 * 1024 {
            return Err(error("configuration", "Hadoop config exceeds 1 MiB"));
        }
        let content = std::str::from_utf8(&bytes)
            .map_err(|_| error("configuration", "Hadoop config must be UTF-8"))?;
        let doc = roxmltree::Document::parse(content)
            .map_err(|_| error("configuration", "Invalid Hadoop XML"))?;
        let root = doc.root_element();
        if !root.has_tag_name("configuration") {
            return Err(error("configuration", "Invalid Hadoop XML root"));
        }
        for prop in root.children().filter(|n| n.has_tag_name("property")) {
            let field = |tag| {
                prop.children()
                    .find(|n| n.has_tag_name(tag))
                    .and_then(|n| n.text())
                    .map(str::trim)
            };
            if let (Some(name), Some(value)) = (field("name"), field("value")) {
                if !name.is_empty() {
                    options.insert(name.into(), value.into());
                }
            }
        }
        loaded = true;
    }
    if !loaded {
        return Err(error(
            "configuration",
            "Hadoop directory must contain core-site.xml or hdfs-site.xml",
        ));
    }
    Ok(options)
}
