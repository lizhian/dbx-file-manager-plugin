import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { signedPackageFixture, fixtureMarketplace } from './signed-package-fixture.mjs';

const [binary, ...inputPackages] = process.argv.slice(2);
let [firstPackage, secondPackage] = inputPackages;
assert.ok([binary, firstPackage, secondPackage].every((path) => path && isAbsolute(path)),
  'Usage: node scripts/host-lifecycle-contract.mjs <absolute-dbx-web> <absolute-0.1.0.dbxp> <absolute-0.1.1.dbxp>');
const pluginId = 'io.github.lizhian.file-manager';
const providerId = `${pluginId}.ftp.files`;
const runId = randomUUID();
const connectionId = `lifecycle-${runId}`;
const uri = `ftp:/dbx-lifecycle-${runId}`;
const dataDir = await mkdtemp(join(tmpdir(), 'dbx-host-lifecycle-'));
const password = randomUUID();
const ftpPassword = 'dbx-password';
const redact = (text) => String(text).replaceAll(password, '<redacted>').replaceAll(ftpPassword, '<fixture-secret>');
const signedMode = process.env.DBX_LIFECYCLE_SIGNED === '1';
const report = { runId, dataDir, signedMode, passed: false, steps: [] };
let server, exited, cookie, base, created = false, serverLog = '';
let signing, marketplace;

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function request(path, body, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${redact(text)}`);
  return { value: text ? JSON.parse(text) : null, response };
}

async function api(path, body, expected = 200) { return (await request(path, body, expected)).value; }

async function start() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  cookie = undefined;
  server = spawn(binary, [], { env: { ...process.env, DBX_DATA_DIR: dataDir, DBX_PORT: String(port),
    DBX_PASSWORD: password, DBX_DISABLE_PASSWORD: 'false', DBX_PUBLIC_BASE_PATH: '/', RUST_LOG: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
  exited = new Promise((resolve) => { server.once('exit', resolve); server.once('error', resolve); });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverLog = (serverLog + redact(chunk)).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { await api('/auth/check'); ready = true; break; } catch { /* the isolated listener may still be starting */ }
    if (server.exitCode !== null || server.signalCode) break;
    await delay(200);
  }
  assert.ok(ready, 'Isolated Web backend did not become ready');
  const login = await request('/auth/login', { password });
  cookie = login.response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'Password-protected backend did not issue a session cookie');
  assert.equal((await api('/version')).version, '0.6.5');
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode) return;
  server.kill('SIGINT');
  const closed = await Promise.race([exited.then(() => true), delay(10000).then(() => false)]);
  if (!closed) { server.kill('SIGTERM'); await exited; }
}

async function install(path, { unsigned = !signedMode, corrupt = false, status = 200 } = {}) {
  const bytes = await readFile(path);
  const form = new FormData();
  form.append('file', new Blob([corrupt ? bytes.subarray(0, bytes.length - 32) : bytes]), basename(path));
  return api(`/plugins/install?allow_unsigned=${unsigned}`, form, status);
}

async function active() {
  const sessions = await api('/plugins/active');
  return sessions.find((session) => session.pluginId === pluginId);
}

async function pidGone(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(50);
  }
  throw new Error('Old sidecar process was not terminated');
}

const scope = { pluginId, providerId, connectionId };
async function readRemote() {
  const result = await api('/plugins/filesystem/read', { ...scope, uri: `${uri}/state.txt`, maxBytes: 128 });
  assert.equal(result.dataBase64, Buffer.from('lifecycle persistence').toString('base64'));
  assert.equal(result.truncated, false);
}

async function connect(saved) {
  await api('/connection/connect', { config: saved });
  const session = await active();
  assert.equal(session?.state, 'running');
  assert.ok(Number.isInteger(session.processId) && session.processId > 0);
  return session.processId;
}

async function cleanupRemote() {
  await api('/plugins/filesystem/delete', { ...scope, uri: `${uri}/state.txt`, recursive: false });
  await api('/plugins/filesystem/delete', { ...scope, uri, recursive: false });
  const absent = await api('/plugins/filesystem/stat', { ...scope, uri }, 400);
  assert.equal(absent.data?.code, 'not_found');
  created = false;
}

try {
  report.hostBinarySha256 = await sha256(binary);
  if (signedMode) {
    report.unsignedInputs = { first: await sha256(firstPackage), second: await sha256(secondPackage) };
    signing = await signedPackageFixture(process.env.DBX_PLUGIN_PACKAGER_BINARY, [firstPackage, secondPackage], join(dataDir, 'signed'));
    [firstPackage, secondPackage] = signing.packages;
    marketplace = await fixtureMarketplace(signing);
    report.signing = { keyId: signing.keyId, publicKey: signing.publicKey, privateKeyWritten: false };
  }
  report.packages = { first: await sha256(firstPackage), second: await sha256(secondPackage) };
  await start();
  if (signedMode) {
    const unknown = await install(firstPackage, { unsigned: true, status: 400 });
    assert.match(JSON.stringify(unknown), /untrusted key/);
    assert.deepEqual(await api('/plugins'), []);
    await api('/plugins/trusted-keys/save', { keyId: signing.keyId, publicKey: signing.publicKey });
    const reused = await api('/plugins/trusted-keys/save', { keyId: signing.keyId, publicKey: signing.alternatePublicKey }, 400);
    assert.match(JSON.stringify(reused), /already exists with a different public key/);
    await api('/plugins/repositories/save', marketplace.repository);
    report.steps.push({ name: 'unknown-key-and-key-id-reuse-rejected' });
  }
  const initial = await install(firstPackage);
  assert.equal(initial.plugin.manifest.version, '0.1.0');
  assert.equal(initial.packageSha256, report.packages.first);
  if (signedMode) assert.deepEqual(initial.signature, { status: 'trusted', key_id: signing.keyId });
  const config = { id: connectionId, name: 'Disposable lifecycle FTP', db_type: 'plugin',
    host: '127.0.0.1', port: 2121, username: 'dbx', password: '', save_password: true,
    plugin_id: pluginId, plugin_connection_provider: `${pluginId}.ftp`, plugin_connection_type: 'ftp',
    external_config: { root: '/ftp/dbx/' }, connection_secrets: { password: ftpPassword } };
  await api('/connection/save', { configs: [config] });
  const saved = (await api('/connection/list'))[0];
  assert.ok(saved.connection_secrets.password === ftpPassword, 'Saved plugin secret was not restored');
  const persisted = JSON.parse(execFileSync('sqlite3', ['-json', join(dataDir, 'dbx.db'), 'SELECT config_json FROM connections'], { encoding: 'utf8' }));
  assert.equal(persisted.length, 1);
  assert.ok(!persisted[0].config_json.includes(ftpPassword), 'Secret leaked into persistent connection JSON');
  let pid = await connect(saved);
  await api('/plugins/filesystem/create-directory', { ...scope, uri });
  created = true;
  await api('/plugins/filesystem/write', { ...scope, uri: `${uri}/state.txt`, dataBase64: Buffer.from('lifecycle persistence').toString('base64'), create: true, overwrite: false });
  await readRemote();
  report.steps.push({ name: 'install-connect-secret-storage', version: '0.1.0', pid });

  const missingRollback = await api('/plugins/rollback', { plugin_id: pluginId }, 400);
  assert.match(JSON.stringify(missingRollback), /does not have a rollback version/);
  assert.equal((await active())?.processId, pid, 'Missing rollback target stopped the healthy sidecar');
  await readRemote();
  report.steps.push({ name: 'missing-rollback-preserves-active-runtime' });

  const uninstallBlocked = await api('/plugins/uninstall', { plugin_id: pluginId }, 400);
  assert.match(JSON.stringify(uninstallBlocked), /connections still use it/);
  assert.equal((await active()).processId, pid);
  await readRemote();
  report.steps.push({ name: 'saved-reference-prevents-uninstall' });

  if (signedMode) {
    for (const [field, expected] of [
      ['publisher', /publisher.*does not match catalog publisher/],
      ['permissions', /permissions.*do not match catalog permissions/],
      ['signing-key', /signing key.*does not match repository key/],
    ]) {
      marketplace.mismatch(field);
      const mismatch = await api('/plugins/marketplace/install', marketplace.request, 400);
      assert.match(JSON.stringify(mismatch), expected);
      assert.equal((await active()).processId, pid);
      await readRemote();
      report.steps.push({ name: `catalog-${field}-mismatch-preserves-runtime` });
    }
    marketplace.mismatch();
  }

  assert.equal(execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim(), String(server.pid));
  process.kill(pid, 'SIGSTOP');
  let upgradeResult;
  const operation = signedMode ? api('/plugins/marketplace/install', marketplace.request) : install(secondPackage);
  const upgrading = operation.then((value) => { upgradeResult = { value }; }, (error) => { upgradeResult = { error }; });
  let publishedWhileOldProcessAlive = false;
  while (!upgradeResult) {
    const directory = join(dataDir, 'plugins', pluginId, 'activations');
    const records = [];
    for (const file of await readdir(directory)) {
      if (/^\d+-.*\.json$/.test(file)) records.push(JSON.parse(await readFile(join(directory, file), 'utf8')));
    }
    const latest = records.sort((a, b) => b.sequence - a.sequence)[0];
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive && latest?.version === '0.1.1') publishedWhileOldProcessAlive = true;
    await delay(10);
  }
  await upgrading;
  if (upgradeResult.error) throw upgradeResult.error;
  const upgraded = upgradeResult.value;
  assert.equal(publishedWhileOldProcessAlive, false, 'New activation was published while the old sidecar was still alive');
  assert.equal(upgraded.plugin.manifest.version, '0.1.1');
  assert.equal(upgraded.previousVersion, '0.1.0');
  assert.equal(upgraded.packageSha256, report.packages.second);
  if (signedMode) assert.deepEqual(upgraded.signature, { status: 'trusted', key_id: signing.keyId });
  await pidGone(pid);
  assert.equal(await active(), undefined);
  assert.ok(JSON.stringify((await api('/connection/list'))[0]) === JSON.stringify(saved), 'Upgrade changed saved connection or secret');
  pid = await connect(saved);
  await readRemote();
  report.steps.push({ name: 'upgrade-reconnect', version: '0.1.1', pid, oldProcessStoppedBeforePublication: !publishedWhileOldProcessAlive });

  const rollback = await api('/plugins/rollback', { plugin_id: pluginId });
  assert.equal(rollback.plugin.manifest.version, '0.1.0');
  await pidGone(pid);
  pid = await connect(saved);
  await readRemote();
  assert.ok(JSON.stringify((await api('/connection/list'))[0]) === JSON.stringify(saved), 'Rollback changed saved connection or secret');
  report.steps.push({ name: 'rollback-reconnect', version: '0.1.0', pid });

  const corruptRejected = await install(secondPackage, { corrupt: true, status: 400 });
  assert.match(JSON.stringify(corruptRejected), /zip|archive|central directory/i, 'Corrupt package was not rejected by archive validation');
  const unsignedRejected = await install(inputPackages[1], { unsigned: false, status: 400 });
  assert.match(JSON.stringify(unsignedRejected), /trusted Ed25519 signature/, 'Unsigned package was not rejected by signature policy');
  if (signedMode) {
    const tampered = await install(signing.tampered, { unsigned: true, status: 400 });
    assert.match(JSON.stringify(tampered), /signature verification failed/);
    await api('/plugins/trusted-keys/remove', { keyId: signing.keyId });
    const revoked = await install(secondPackage, { status: 400 });
    assert.match(JSON.stringify(revoked), /untrusted key/);
    await api('/plugins/trusted-keys/save', { keyId: signing.keyId, publicKey: signing.publicKey });
    report.steps.push({ name: 'signature-tampering-and-revoked-key-rejected' });
  }
  assert.equal((await api('/plugins')).find((plugin) => plugin.manifest.id === pluginId).manifest.version, '0.1.0');
  assert.equal((await active()).processId, pid);
  await readRemote();
  report.steps.push({ name: 'failed-install-preserves-active-version-and-process' });

  assert.equal(execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim(), String(server.pid), 'Refusing to kill a process outside this isolated backend');
  process.kill(pid, 'SIGKILL');
  await pidGone(pid);
  for (let i = 0; i < 100 && (await active())?.state === 'running'; i++) await delay(50);
  pid = await connect(saved);
  await readRemote();
  report.steps.push({ name: 'sidecar-crash-reconnect', pid });

  await stop();
  await pidGone(pid);
  await start();
  assert.ok(JSON.stringify((await api('/connection/list'))[0]) === JSON.stringify(saved), 'Backend restart changed saved connection or secret');
  pid = await connect(saved);
  await readRemote();
  report.steps.push({ name: 'host-restart-reconnect', pid });
  await cleanupRemote();
  const remaining = await api('/connection/list');
  assert.ok(remaining.length === 1 && remaining[0].id === connectionId, 'Unexpected connection in disposable profile');
  await api('/connection/save', { configs: [] });
  assert.deepEqual(await api('/plugins/uninstall', { plugin_id: pluginId }), []);
  await pidGone(pid);
  if (signedMode) {
    await api('/plugins/trusted-keys/remove', { keyId: signing.keyId });
    await api('/plugins/repositories/remove', { repositoryId: marketplace.repository.id });
    assert.ok(!(await api('/plugins/trusted-keys')).some((key) => key.keyId === signing.keyId));
  }
  report.steps.push({ name: 'remote-cleanup-remove-reference-uninstall' });
  report.passed = true;
} catch (error) {
  report.error = redact(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      const saved = (await api('/connection/list')).find((config) => config.id === connectionId);
      if (saved) await connect(saved);
      await cleanupRemote();
    } catch (error) { report.cleanupError = redact(error.message); }
  }
  await stop();
  if (marketplace) await marketplace.close();
  report.remoteCleanupRequired = created;
  report.serverLog = serverLog;
  const evidence = new URL('../docs/evidence/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  await writeFile(new URL(`host-lifecycle-${runId}.json`, evidence), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ runId, passed: report.passed, steps: report.steps, error: report.error,
    remoteCleanupRequired: created, evidence: `docs/evidence/host-lifecycle-${runId}.json` }, null, 2));
}
