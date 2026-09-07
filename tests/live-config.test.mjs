import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { fixtureConnection, protocols } from '../scripts/live-contract.mjs';
import { readJson } from '../scripts/validate-manifest.mjs';
const manifest = readJson('manifest.json');
test('six live configurations exactly use their declared flat config and secret fields', () => {
  const env = { DBX_FM_SFTP_KEY_PATH: fileURLToPath(import.meta.url) };
  for (const protocol of protocols) {
    const { provider, connection } = fixtureConnection(protocol, env, 'unit');
    const contribution = manifest.contributions.find((c) => c.id === provider.id);
    assert.equal(provider.databaseType, contribution.database_type);
    for (const [binding, values] of [['config', connection.external_config], ['secret', connection.connection_secrets]]) {
      const allowed = contribution.fields.filter((f) => f.binding === binding).map((f) => f.key);
      for (const key of Object.keys(values)) assert.ok(allowed.includes(key), `${protocol}.${key}`);
    }
    assert.equal(connection.plugin_connection_provider, provider.id);
    assert.equal(connection.plugin_connection_type, provider.databaseType);
  }
});
test('SFTP accepts an explicit existing key path without reading its contents', () => {
  const key = fileURLToPath(import.meta.url);
  const { connection } = fixtureConnection('sftp', { DBX_FM_SFTP_KEY_PATH: key }, 'unit');
  assert.equal(connection.connection_secrets.private_key, key);
  assert.throws(() => fixtureConnection('sftp', { DBX_FM_SFTP_KEY_PATH: 'relative-key' }));
});
test('fixture overrides remain outside source and ports are validated', () => {
  const { connection } = fixtureConnection('ftp', { DBX_FM_FTP_PORT: '2122', DBX_FM_FTP_ROOT: '/test/', DBX_FM_FTP_PASSWORD: 'canary' }, 'unit');
  assert.equal(connection.port, 2122);
  assert.equal(connection.external_config.root, '/test/');
  assert.equal(connection.connection_secrets.password, 'canary');
  assert.throws(() => fixtureConnection('ftp', { DBX_FM_FTP_PORT: '65536' }));
  assert.throws(() => fixtureConnection('unknown', {}));
});
