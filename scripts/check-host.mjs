import { createServer } from 'vite';
import { reactive } from 'vue';
import { resolve } from 'node:path';

// Read-only reproduction against the checked-out host, not a patched copy.
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { PluginHostBridge } = await server.ssrLoadModule(resolve('runtime/dbx/apps/desktop/src/lib/plugins/pluginHostBridge.ts'));
  new PluginHostBridge({}, {}, { connectionId: 'probe' }, () => null, {});
  try {
    new PluginHostBridge({}, {}, reactive({ connectionId: 'probe' }), () => null, {});
    console.log('PASS: host accepts Vue reactive workbench context');
  } catch (error) {
    console.error(`BLOCKED: host cannot initialize a connection workbench: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
