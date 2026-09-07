use dbx_plugin_dbx_file_manager_plugin::{Handler, Plugin, PLUGIN_ID};
use dbx_plugin_sdk::{PluginMetadata, PluginServer, PluginTransport};
use std::sync::Arc;

fn main() -> std::io::Result<()> {
    let plugin = Arc::new(Plugin::new()?);
    let metadata = PluginMetadata::new(PLUGIN_ID, env!("CARGO_PKG_VERSION"))
        .with_capability("connections")
        .with_capability("filesystem")
        .with_capability("filesystem.download-temp-v1");
    let result = PluginServer::new(metadata, Handler(plugin.clone()))
        .transport(PluginTransport::Framed)
        .worker_threads(8)
        .serve();
    plugin.shutdown();
    result
}
