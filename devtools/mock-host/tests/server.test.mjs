import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createMockHost } from '../server.mjs';
import { ConnectionStore, lifecyclePayload, validateRecord } from '../connections.mjs';
import { readAsset } from '../assets.mjs';

const manifest = { id: 'example.echo', version: '1.0.0', name: 'Generic echo', engines: { host_api: '>=1.0.0, <2.0.0' }, permissions: ['host.events', 'host.binary'],
  entrypoints: { backend: { transport: 'stdio-framed', protocol_versions: [1] }, ui: { root: 'ui', entry: 'ui/index.html' } },
  contributions: [{ type: 'connection-provider', id: 'example.connection', database_type: 'example', label: 'Example', workbench: 'example.main', capabilities: ['test', 'connect', 'disconnect'], fields: [
    { key: 'name', type: 'text', binding: 'name', required: true }, { key: 'endpoint', type: 'text', binding: 'config', required: true },
    { key: 'count', type: 'number', binding: 'config' }, { key: 'enabled', type: 'boolean', binding: 'config' }, { key: 'password', type: 'password', binding: 'secret' },
  ] }, { type: 'workbench', id: 'example.main', label: 'Main' }] };
const values = { name: 'Example connection', endpoint: 'test-endpoint', count: 7, enabled: true, password: 'test-password' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dbx-mock-test-'));
  await mkdir(join(root, 'ui')); await writeFile(join(root, 'ui/index.html'), '<html><head></head><body>Test</body></html>');
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  const host = await createMockHost({ project: root, uiRoot: 'ui', backend: process.execPath,
    backendArgs: [fileURLToPath(new URL('./echo-sidecar.mjs', import.meta.url))], dataDir: join(root, 'data'), shellHtml: join(root, 'ui/index.html'), port: 0,
    buildBackend: async () => { throw new Error('Intentional build failure'); } });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  const response = await fetch(`${host.origin}/api/bootstrap`), bootstrap = await response.json();
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: host.origin, 'X-Mock-Csrf': bootstrap.csrf, 'Content-Type': 'application/json' };
  const request = async (path, data = {}, overrides = {}) => {
    const response = await fetch(`${host.origin}/api/${path}`, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(data) });
    return { status: response.status, ...await response.json() };
  };
  return { root, host, request, headers };
}
test('configuration mapping preserves typed external config and separates secrets', () => {
  const record = validateRecord(manifest, { providerId: 'example.connection', values });
  const c = lifecyclePayload(manifest, record).connection;
  assert.deepEqual(c.external_config, { endpoint: 'test-endpoint', count: 7, enabled: true });
  assert.deepEqual(c.connection_secrets, { password: 'test-password' });
  assert.throws(() => validateRecord(manifest, { providerId: record.providerId, values: { ...values, count: '7' } }), /type/);
  assert.throws(() => validateRecord(manifest, { providerId: record.providerId, values: { ...values, endpoint: '' } }), /Missing/);
});
test('save, reload, iframe isolation, generic RPC and close lifecycle', async t => {
  const { root, host, request } = await fixture(t);
  const saved = await request('connections/save', { providerId: 'example.connection', values });
  assert.equal(saved.status, 200); const id = saved.value.id;
  assert.equal(JSON.stringify(saved).includes('test-password'), false);
  const stored = new ConnectionStore(join(root, 'data'), manifest); await stored.load();
  assert.deepEqual(stored.get(id).values, values);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(root, 'data'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'data/connections.json'))).mode & 0o777, 0o600);
  }
  const opened = await request('connections/connect', { id }); const f = opened.value.frame;
  assert.equal((await request('connections/connect', { id })).value.frame.id, f.id);
  assert.deepEqual(f.context, { connectionId: id, providerId: 'example.connection', connectionType: 'example' });
  assert.equal(JSON.stringify(f).includes('test-password'), false);
  const document = (await request('frame-document', { frameId: f.id })).value;
  assert.match(document.html, /Content-Security-Policy/); assert.match(document.html, /window.dbxPlugin/);
  const call = (method, params) => request('bridge', { frameId: f.id, channel: document.channel, method, params });
  assert.deepEqual((await call('backend.invoke', { method: 'echo', params: { anyBusiness: 123 } })).value, { anyBusiness: 123 });
  assert.equal((await call('host.openWorkbench', { contributionId: 'example.main' })).status, 400);
  assert.equal((await call('host.openFilesystem', {})).status, 400);
  assert.equal((await call('backend.invoke', { method: 'echo', params: 'x'.repeat(2 * 1024 * 1024) })).status, 400);
  assert.equal((await request('bridge', { frameId: f.id, channel: 'old', method: 'host.getContext' })).status, 400);
  await request('connections/save', { id, providerId: 'example.connection', values: { ...values, name: 'Renamed connection' } });
  const renamed = (await request('connections/connect', { id })).value.frame;
  assert.equal(renamed.id, f.id); assert.equal(renamed.name, 'Renamed connection');
  assert.equal((await request('frames/close', { id: f.id })).value.connections[0].connected, false);
  const failedBuild = await request('backend/restart'); assert.equal(failedBuild.status, 400); assert.equal(host.sidecar.state, 'stopped');
});
test('loopback endpoint rejects cross-origin, forged Host, CSRF and unowned frames', async t => {
  const { host, request, headers } = await fixture(t);
  assert.equal((await request('connections/save', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('connections/save', {}, { 'X-Mock-Csrf': 'wrong' })).status, 403);
  const bad = await new Promise((resolve, reject) => {
    const request = http.get(`${host.origin}/api/bootstrap`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  }); assert.equal(bad, 403);
  const saved = await request('connections/save', { providerId: 'example.connection', values });
  const f = (await request('connections/connect', { id: saved.value.id })).value.frame;
  const other = await fetch(`${host.origin}/api/bootstrap`); const boot = await other.json();
  assert.equal((await request('frame-document', { frameId: f.id }, { ...headers, Cookie: other.headers.get('set-cookie').split(';')[0], 'X-Mock-Csrf': boot.csrf })).status, 400);
});
test('asset reader rejects traversal and symlinks outside the UI root', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'secret'), 'test-secret'); await symlink(join(root, 'secret'), join(root, 'ui/link'));
  await assert.rejects(readAsset(join(root, 'ui'), '../secret'), /outside/);
  await assert.rejects(readAsset(join(root, 'ui'), 'link'), /outside/);
  assert.equal(Buffer.from((await readAsset(join(root, 'ui'), 'index.html')).dataBase64, 'base64').toString(), await readFile(join(root, 'ui/index.html'), 'utf8'));
});

test('UI root overrides and port collision fallback work without changing the plugin manifest', async t => {
  const { root, host } = await fixture(t);
  await mkdir(join(root, 'alternate-ui')); await writeFile(join(root, 'alternate-ui/index.html'), '<html>Alternate output</html>');
  const second = await createMockHost({ project: root, uiRoot: 'alternate-ui', backend: process.execPath,
    backendArgs: [fileURLToPath(new URL('./echo-sidecar.mjs', import.meta.url))], dataDir: join(root, 'second-data'), shellHtml: join(root, 'alternate-ui/index.html'), port: Number(new URL(host.origin).port) });
  try { assert.notEqual(second.origin, host.origin); assert.equal((await fetch(second.origin)).status, 200); }
  finally { await second.close(); }
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, engines: { host_api: '>=2.0.0' } }));
  await assert.rejects(createMockHost({ project: root }), /does not support Host API/);
});
