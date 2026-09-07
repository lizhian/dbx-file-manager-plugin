import assert from 'node:assert/strict';
import { accessSync, constants, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, isAbsolute, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FramedClient, RpcError } from './framed-client.mjs';

export const protocols = ['ftp', 'sftp', 's3', 'webdav', 'webhdfs', 'hdfs-native'];
const pluginId = 'io.github.lizhian.file-manager';
const fixture = fileURLToPath(new URL('../tests/fixtures/file-manager/', import.meta.url));
const terminal = new Set(['completed', 'failed', 'cancelled']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function fixtureConnection(protocol, env = process.env, runId = randomUUID()) {
  assert.ok(protocols.includes(protocol), 'Unknown fixture protocol');
  const read = (key, fallback) => env[`DBX_FM_${key}`] ?? fallback;
  const port = (key, fallback) => {
    const value = Number(read(key, fallback));
    assert.ok(Number.isInteger(value) && value > 0 && value <= 65535, 'Invalid fixture port');
    return value;
  };
  const connection = {
    id: `live-${protocol}-${runId}`, name: `Live ${protocol}`, db_type: 'plugin',
    plugin_id: pluginId, plugin_connection_provider: `${pluginId}.${protocol}`,
    plugin_connection_type: protocol, host: '', port: 0, username: '', read_only: false,
    external_config: { root: '/' }, connection_secrets: {},
  };
  const config = connection.external_config;
  const secrets = connection.connection_secrets;
  switch (protocol) {
    case 'ftp':
      connection.host = read('FTP_HOST', '127.0.0.1');
      connection.port = port('FTP_PORT', 2121);
      connection.username = read('FTP_USERNAME', 'dbx');
      config.root = read('FTP_ROOT', '/ftp/dbx/');
      secrets.password = read('FTP_PASSWORD', 'dbx-password');
      break;
    case 'sftp': {
      connection.host = read('SFTP_HOST', '127.0.0.1');
      connection.port = port('SFTP_PORT', 2222);
      connection.username = read('SFTP_USERNAME', 'dbx');
      config.root = read('SFTP_ROOT', '/config');
      config.authentication = 'private_key';
      const key = read('SFTP_KEY_PATH', join(fixture, 'runtime/sftp/id_ed25519'));
      assert.ok(isAbsolute(key), 'DBX_FM_SFTP_KEY_PATH must be absolute');
      // Pass the existing path only. The harness never reads or copies private keys.
      accessSync(key, constants.R_OK);
      secrets.private_key = key;
      break;
    }
    case 's3':
      Object.assign(config, { endpoint: read('S3_ENDPOINT', 'http://127.0.0.1:9000'),
        root: read('S3_ROOT', '/root/'), region: read('S3_REGION', 'us-east-1'),
        bucket: read('S3_BUCKET', 'dbx'), path_style: true });
      secrets.access_key = read('S3_ACCESS_KEY', 'dbx-access-key');
      secrets.secret_key = read('S3_SECRET_KEY', 'dbx-secret-key');
      if (read('S3_SESSION_TOKEN', '')) secrets.session_token = read('S3_SESSION_TOKEN');
      break;
    case 'webdav':
      Object.assign(config, { endpoint: read('WEBDAV_ENDPOINT', 'http://127.0.0.1:8080'),
        root: read('WEBDAV_ROOT', '/'), authentication: 'basic' });
      connection.username = read('WEBDAV_USERNAME', 'dbx');
      secrets.password = read('WEBDAV_PASSWORD', 'dbx-password');
      break;
    case 'webhdfs':
      Object.assign(config, { endpoint: read('WEBHDFS_ENDPOINT', 'http://127.0.0.1:9870'),
        root: read('WEBHDFS_ROOT', '/'), simple_user: read('WEBHDFS_USER', 'dbx'), use_delegation_token: false });
      break;
    case 'hdfs-native':
      Object.assign(config, { name_node_uri: read('HDFS_NAME_NODE_URI', 'hdfs://127.0.0.1:19000'),
        root: read('HDFS_ROOT', '/'), hadoop_config_directory: read('HADOOP_CONFIG_DIRECTORY', join(fixture, 'config/hadoop/client')) });
      break;
  }
  return {
    provider: { id: connection.plugin_connection_provider, databaseType: protocol }, connection,
    ...(['ftp', 'sftp'].includes(protocol) ? { runtime: { host: connection.host, port: connection.port } } : {}),
  };
}

export function checkSnapshot(snapshot, scope, direction, uri) {
  assert.equal(snapshot.providerId, scope.providerId);
  assert.equal(snapshot.connectionId, scope.connectionId);
  assert.equal(snapshot.direction, direction);
  assert.equal(snapshot.uri, uri);
  assert.equal(typeof snapshot.transferId, 'string');
  assert.ok(snapshot.transferId.length > 0);
  assert.ok(['queued', 'running', ...terminal].includes(snapshot.state));
  assert.ok(Number.isSafeInteger(snapshot.bytesTransferred) && snapshot.bytesTransferred >= 0);
  assert.ok(snapshot.totalBytes === null || (Number.isSafeInteger(snapshot.totalBytes) && snapshot.totalBytes >= snapshot.bytesTransferred));
  assert.ok('error' in snapshot);
}

export function checkCapabilities(result, expected, forbidden = []) {
  const known = ['list', 'stat', 'read', 'write', 'mkdir', 'delete', 'copy', 'rename', 'upload', 'download'];
  assert.ok(Array.isArray(result.capabilities), 'Canonical capabilities array is required');
  assert.equal(new Set(result.capabilities).size, result.capabilities.length);
  for (const cap of result.capabilities) assert.ok(known.includes(cap), 'Unknown dynamic capability');
  for (const cap of expected) assert.ok(result.capabilities.includes(cap), `Missing negotiated ${cap}`);
  for (const cap of forbidden) assert.ok(!result.capabilities.includes(cap), `Forbidden negotiated ${cap}`);
}

export function checkFileEntry(entry, uri, size) {
  assert.equal(entry.uri, uri);
  assert.equal(entry.kind, 'file');
  assert.equal(entry.size, size);
  assert.equal(typeof entry.name, 'string');
}

async function expectError(promise, codes) {
  await assert.rejects(promise, (error) => error instanceof RpcError && codes.includes(error.data?.code));
}

async function transfer(client, scope, direction, uri, localPath, size) {
  const startedAt = performance.now();
  const started = await client.request(`filesystem/transfer/start${direction === 'upload' ? 'Upload' : 'Download'}`,
    { ...scope, uri, localPath, overwrite: false });
  assert.equal(typeof started.transferId, 'string');
  assert.ok(started.transferId.length > 0);
  checkSnapshot(started, scope, direction, uri);
  const snapshot = await client.request('filesystem/transfer/status', { ...scope, transferId: started.transferId });
  checkSnapshot(snapshot, scope, direction, uri);
  let event;
  try {
    event = await client.waitEvent((event) => event.method === 'filesystem/transfer/progress'
      && event.params?.transferId === snapshot.transferId && terminal.has(event.params.state));
  } catch (error) {
    const status = await client.request('filesystem/transfer/status', { ...scope, transferId: snapshot.transferId });
    console.error(`Transfer collector failure: ${JSON.stringify({ state: status.state,
      bytesTransferred: status.bytesTransferred, totalBytes: status.totalBytes,
      elapsedMs: Math.round(performance.now() - startedAt) })}`);
    throw error;
  }
  checkSnapshot(event.params, scope, direction, uri);
  if (event.params.state !== 'completed') {
    const code = (value) => typeof value === 'string' && /^[a-z_]+$/.test(value) ? value : 'unknown';
    const error = event.params.error;
    throw new Error(`${direction} ${event.params.state}: ${JSON.stringify({ code: code(error?.data?.code),
      cause: code(error?.data?.recovery?.cause?.data?.code),
      bytesTransferred: event.params.bytesTransferred, totalBytes: event.params.totalBytes,
      elapsedMs: Math.round(performance.now() - startedAt),
      cleanupSucceeded: error?.data?.recovery?.cleanupSucceeded,
      destinationMayExist: error?.data?.recovery?.destinationMayExist })}`);
  }
  assert.equal(event.params.state, 'completed', `${direction} must complete`);
  assert.equal(event.params.bytesTransferred, size);
  assert.equal(event.params.totalBytes, size);
  assert.equal(event.params.error, null);
  let previous = 0;
  for (const item of client.events.filter((e) => e.params?.transferId === snapshot.transferId)) {
    checkSnapshot(item.params, scope, direction, uri);
    assert.ok(item.params.bytesTransferred >= previous, 'Progress must be monotonic');
    previous = item.params.bytesTransferred;
  }
  const status = await client.request('filesystem/transfer/status', { ...scope, transferId: snapshot.transferId });
  assert.equal(status.state, 'completed');
  assert.equal(status.bytesTransferred, size);
  const list = await client.request('filesystem/transfer/list', scope);
  assert.ok(list.transfers.some((t) => t.transferId === snapshot.transferId && t.state === 'completed'));
}

export async function exerciseProtocol(client, protocol, env = process.env) {
  const runId = randomUUID();
  const lifecycle = fixtureConnection(protocol, env, runId);
  const scope = { providerId: `${pluginId}.${protocol}.files`, connectionId: lifecycle.connection.id };
  const root = `${protocol}:/dbx-plugin-contract-${runId}`;
  const small = `${root}/source.txt`;
  const copy = `${root}/copy.txt`;
  const renamed = `${root}/renamed.txt`;
  const large = `${root}/large.bin`;
  const emptyInline = `${root}/empty-inline.txt`;
  const emptyRemote = `${root}/empty.bin`;
  const payload = Buffer.from('DBX framed contract fixture\n');
  const local = mkdtempSync(join(tmpdir(), 'dbx-plugin-contract-'));
  const request = (method, params = {}) => client.request(`filesystem/${method}`, { ...scope, ...params });
  const failures = [];
  let connected = false;
  let created = false;
  try {
    assert.equal((await client.request('connection/test', lifecycle)).success, true);
    assert.equal((await client.request('connection/connect', lifecycle)).success, true);
    connected = true;
    const caps = await request('capabilities');
    checkCapabilities(caps, ['list', 'stat', 'read', 'write', 'mkdir', 'delete', 'copy', 'rename', 'upload', 'download']);
    assert.equal((await request('createDirectory', { uri: root })).success, true);
    created = true;
    assert.equal((await request('write', { uri: small, dataBase64: payload.toString('base64'), create: true, overwrite: false })).success, true);
    const stat = await request('stat', { uri: small });
    checkFileEntry(stat, small, payload.length);
    assert.deepEqual(Buffer.from((await request('read', { uri: small, maxBytes: 1024 })).dataBase64, 'base64'), payload);
    const preview = await request('read', { uri: small, maxBytes: 4 });
    assert.equal(preview.truncated, true);
    assert.equal(Buffer.from(preview.dataBase64, 'base64').length, 4);
    await expectError(request('write', { uri: small, dataBase64: '', create: true, overwrite: false }), ['already_exists']);
    await expectError(request('read', { uri: `${protocol}:/../escape` }), ['configuration', 'invalid_path']);
    await expectError(request('copy', { sourceUri: small, targetUri: copy, targetConnectionId: 'another-connection' }), ['unsupported']);
    assert.equal((await request('copy', { sourceUri: small, targetUri: copy, overwrite: false })).success, true);
    assert.deepEqual(Buffer.from((await request('read', { uri: copy })).dataBase64, 'base64'), payload);
    assert.equal((await request('rename', { sourceUri: copy, targetUri: renamed, overwrite: false })).success, true);
    await expectError(request('stat', { uri: copy }), ['not_found']);
    assert.deepEqual(Buffer.from((await request('read', { uri: renamed })).dataBase64, 'base64'), payload);
    const entries = [];
    const cursors = new Set();
    let cursor;
    do {
      const page = await request('list', { uri: root, limit: 1, ...(cursor ? { cursor } : {}) });
      assert.ok(page.entries.length <= 1);
      for (const entry of page.entries) assert.ok(entry.uri.startsWith(`${root}/`));
      entries.push(...page.entries);
      cursor = page.nextCursor;
      if (cursor) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
      assert.ok(cursors.size < 20, 'Pagination did not terminate');
    } while (cursor);
    assert.ok(entries.some((e) => e.uri === small));
    assert.ok(entries.some((e) => e.uri === renamed));
    await expectError(request('delete', { uri: root, recursive: false }), ['directory_not_empty']);

    // Larger than the host's 4 MiB inline ceiling; bytes travel via local files.
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const upload = join(local, 'upload.bin');
    const download = join(local, 'download.bin');
    writeFileSync(upload, bytes, { flag: 'wx', mode: 0o600 });
    await transfer(client, scope, 'upload', large, upload, bytes.length);
    await transfer(client, scope, 'download', large, download, bytes.length);
    assert.equal(digest(readFileSync(download)), digest(bytes));
    assert.deepEqual(readdirSync(local).sort(), ['download.bin', 'upload.bin']);

    assert.equal((await request('write', { uri: emptyInline, dataBase64: '', create: true, overwrite: false })).success, true);
    checkFileEntry(await request('stat', { uri: emptyInline }), emptyInline, 0);
    assert.equal((await request('read', { uri: emptyInline })).dataBase64, '');
    const emptyUpload = join(local, 'empty-source.bin');
    const emptyDownload = join(local, 'empty-download.bin');
    writeFileSync(emptyUpload, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    await transfer(client, scope, 'upload', emptyRemote, emptyUpload, 0);
    checkFileEntry(await request('stat', { uri: emptyRemote }), emptyRemote, 0);
    await transfer(client, scope, 'download', emptyRemote, emptyDownload, 0);
    assert.equal(readFileSync(emptyDownload).length, 0);

    const readonly = structuredClone(lifecycle);
    readonly.connection.read_only = true;
    await client.request('connection/disconnect', lifecycle);
    assert.equal((await client.request('connection/connect', readonly)).success, true);
    const readonlyCaps = await request('capabilities');
    checkCapabilities(readonlyCaps, ['read'], ['write', 'mkdir', 'delete', 'copy', 'rename', 'upload']);
    await expectError(request('delete', { uri: small }), ['read_only']);
    await expectError(request('transfer/startUpload', { uri: `${root}/forbidden.bin`, localPath: upload }), ['read_only']);
    assert.deepEqual(Buffer.from((await request('read', { uri: small })).dataBase64, 'base64'), payload);
  } catch (error) {
    failures.push(error);
  } finally {
    if (connected) {
      try {
        await client.request('connection/disconnect', lifecycle);
        await client.request('connection/connect', lifecycle);
        if (created) {
          for (const uri of [emptyRemote, emptyInline, large, renamed, copy, small]) {
            try { await request('delete', { uri, recursive: false }); }
            catch (error) { if (!(error instanceof RpcError && error.data?.code === 'not_found')) throw error; }
          }
          await request('delete', { uri: root, recursive: false });
        }
      } catch (error) { failures.push(new Error(`Remote fixture cleanup failed for ${protocol}: ${error.message}`)); }
      try { await client.request('connection/disconnect', lifecycle); }
      catch (error) { failures.push(error); }
    }
    rmSync(local, { recursive: true, force: true });
  }
  if (failures.length) throw new AggregateError(failures, `${protocol} contract failed; run ${runId}`);
}

export async function main(env = process.env) {
  const binary = env.DBX_FILE_MANAGER_BINARY;
  assert.ok(binary && isAbsolute(binary), 'Set DBX_FILE_MANAGER_BINARY to an existing absolute sidecar executable path');
  accessSync(binary, constants.X_OK);
  const selected = env.DBX_FM_PROTOCOLS ? env.DBX_FM_PROTOCOLS.split(',') : protocols;
  assert.ok(selected.length && new Set(selected).size === selected.length && selected.every((p) => protocols.includes(p)), 'Invalid DBX_FM_PROTOCOLS');
  // Observe the host's default 60s timeout plus bounded backend cleanup before timing out the collector.
  const client = new FramedClient(resolve(binary), { env, timeoutMs: 90000 });
  let failed = 0;
  try {
    const initialized = await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
    assert.equal(initialized.protocolVersion, 1);
    assert.equal(initialized.plugin.id, pluginId);
    for (const protocol of selected) {
      try {
        await exerciseProtocol(client, protocol, env);
        console.log(`PASS ${protocol}: lifecycle, filesystem, 5 MiB/zero-byte transfers, readonly, cleanup`);
      } catch (error) {
        failed++;
        console.error(`FAIL ${protocol}: ${error.message}`);
        for (const detail of error.errors ?? []) console.error(`  ${detail.message}`);
      }
    }
  } finally {
    await client.close();
  }
  console.log(`${selected.length - failed}/${selected.length} selected protocols passed; ${selected.length === 6 ? 'six-protocol run' : 'PARTIAL protocol selection'}. Host UI/install acceptance is separate.`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
