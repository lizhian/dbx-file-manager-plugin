import assert from 'node:assert/strict';
import { createReadStream, constants } from 'node:fs';
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FramedClient } from './framed-client.mjs';
import { checkSnapshot, fixtureConnection } from './live-contract.mjs';
import { transferProxy } from './transfer-proxy.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function residentBytes(pid) {
  const { stdout } = await exec('ps', ['-o', 'rss=', '-p', String(pid)]);
  const kilobytes = Number(stdout.trim());
  assert.ok(Number.isSafeInteger(kilobytes) && kilobytes > 0, 'Missing Sidecar RSS sample');
  return kilobytes * 1024;
}

const binary = process.env.DBX_FILE_MANAGER_BINARY;
assert.ok(binary && isAbsolute(binary), 'Set an absolute DBX_FILE_MANAGER_BINARY');
await access(binary, constants.X_OK);
const runId = randomUUID();
const lifecycle = fixtureConnection('webdav', process.env, runId);
const proxy = await transferProxy(lifecycle.connection.external_config.endpoint, { writeNamespace: `dbx-interruption-${runId}` });
lifecycle.connection.external_config.endpoint = proxy.endpoint;
lifecycle.connection.query_timeout_secs = 15;
const local = await mkdtemp(join(tmpdir(), 'dbx-transfer-interruption-'));
const client = new FramedClient(binary, { timeoutMs: 30000 });
const scope = { providerId: 'io.github.lizhian.file-manager.webdav.files', connectionId: lifecycle.connection.id };
const root = `webdav:/dbx-interruption-${runId}`;
const size = 32 * 1024 * 1024;
const original = Buffer.from('Original destination must survive interrupted transfer.\n');
const source = join(local, 'source.bin');
const sourceUri = `${root}/source.bin`;
const request = (method, params = {}) => client.request(`filesystem/${method}`, { ...scope, ...params });
const terminal = new Set(['completed', 'cancelled', 'failed']);
const knownRemote = new Set([sourceUri]);
const extraConnections = [];
let activeRule;
let created = false;

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function createSource() {
  const file = await open(source, 'wx', 0o600);
  const chunk = Buffer.alloc(256 * 1024, 43);
  try {
    for (let written = 0; written < size;) {
      const { bytesWritten } = await file.write(chunk, 0, Math.min(chunk.length, size - written));
      assert.ok(bytesWritten > 0);
      written += bytesWritten;
    }
  } finally { await file.close(); }
}
async function statusUntil(start, predicate, timeoutMs = 20000, owner = scope) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const status = await client.request('filesystem/transfer/status', { ...owner, transferId: start.transferId });
    checkSnapshot(status, owner, start.direction, start.uri);
    if (predicate(status)) return status;
    assert.ok(performance.now() < deadline, 'Transfer did not reach expected state');
    await delay(5);
  }
}
async function startTransfer(direction, uri, localPath, timeoutMs = 15000) {
  const start = await request(`transfer/start${direction === 'upload' ? 'Upload' : 'Download'}`,
    { uri, localPath, overwrite: true, timeoutMs });
  checkSnapshot(start, scope, direction, uri);
  return start;
}
async function successfulTransfer(direction, uri, localPath) {
  const start = await startTransfer(direction, uri, localPath);
  const status = await statusUntil(start, s => terminal.has(s.state));
  assert.equal(status.state, 'completed', 'Ungated transfer failed (remote detail withheld)');
  assert.equal(status.bytesTransferred, size);
  assert.equal(status.totalBytes, size);
  return start;
}

async function concurrentDownloads(sourceSha256) {
  const result = { connections: 5, tasks: 15, passed: false };
  report.concurrency = result;
  const tasks = [];
  activeRule = proxy.arm('GET', path => path.endsWith(`dbx-interruption-${runId}/source.bin`));
  for (let index = 0; index < 5; index++) {
    const config = structuredClone(lifecycle);
    config.connection.id = `${lifecycle.connection.id}-limit-${index}`;
    config.connection.read_only = true;
    extraConnections.push(config);
    await client.request('connection/connect', config);
    const owner = { ...scope, connectionId: config.connection.id };
    for (let item = 0; item < 3; item++) {
      const localPath = join(local, `limit-${index}-${item}.bin`);
      const start = await client.request('filesystem/transfer/startDownload',
        { ...owner, uri: sourceUri, localPath, overwrite: false, timeoutMs: 15000 });
      checkSnapshot(start, owner, 'download', sourceUri);
      tasks.push({ owner, start, localPath });
    }
  }
  const deadline = performance.now() + 10000;
  let snapshots;
  for (;;) {
    snapshots = [];
    for (const task of tasks) snapshots.push(await client.request('filesystem/transfer/status',
      { ...task.owner, transferId: task.start.transferId }));
    for (let i = 0; i < tasks.length; i++) checkSnapshot(snapshots[i], tasks[i].owner, 'download', sourceUri);
    const running = snapshots.filter(s => s.state === 'running');
    assert.ok(running.length <= 8, 'Global transfer limit exceeded');
    for (const config of extraConnections) assert.ok(running.filter(s => s.connectionId === config.connection.id).length <= 2,
      'Per-connection transfer limit exceeded');
    assert.ok(snapshots.every(s => ['queued', 'running'].includes(s.state)), 'A gated task terminated unexpectedly');
    if (running.length === 8 && running.every(s => s.bytesTransferred > 0)) break;
    assert.ok(performance.now() < deadline, 'Global transfer slots did not fill');
    await delay(5);
  }
  await activeRule.waitBlocked(8);
  result.running = snapshots.filter(s => s.state === 'running').length;
  result.queued = snapshots.filter(s => s.state === 'queued').length;
  result.runningByConnection = extraConnections.map(config => snapshots.filter(s => s.state === 'running'
    && s.connectionId === config.connection.id).length);
  result.pausedHttpStreams = activeRule.snapshots().filter(s => s.blocked && !s.closed).length;
  assert.equal(result.pausedHttpStreams, 8);
  assert.equal(result.queued, 7);
  assert.equal((await readdir(local)).filter(name => name.startsWith('.dbx-download-')).length, 8);
  for (const task of tasks) await client.request('filesystem/transfer/cancel',
    { ...task.owner, transferId: task.start.transferId });
  result.cancelled = 0;
  for (const task of tasks) {
    const status = await statusUntil(task.start, s => terminal.has(s.state), 20000, task.owner);
    assert.equal(status.state, 'cancelled');
    result.cancelled++;
  }
  activeRule.disarm();
  await activeRule.waitClosed();
  result.proxyStreams = activeRule.snapshots();
  activeRule = undefined;
  assert.deepEqual(await readdir(local), ['source.bin'], 'Cancelled downloads left local files');
  result.retries = [];
  for (const [index, config] of extraConnections.entries()) {
    const owner = { ...scope, connectionId: config.connection.id };
    const localPath = join(local, `retry-${index}.bin`);
    const start = await client.request('filesystem/transfer/startDownload',
      { ...owner, uri: sourceUri, localPath, overwrite: false, timeoutMs: 15000 });
    const status = await statusUntil(start, s => terminal.has(s.state), 20000, owner);
    assert.equal(status.state, 'completed', 'Transfer capacity did not recover after cancellation');
    assert.equal(status.bytesTransferred, size);
    assert.equal(await hashFile(localPath), sourceSha256);
    result.retries.push({ connectionId: config.connection.id, sha256: sourceSha256 });
    await rm(localPath);
  }
  await concurrentCompletion(tasks, sourceSha256, 'download', result);
  for (const config of extraConnections) {
    config.connection.read_only = false;
    await client.request('connection/connect', config);
  }
  await concurrentCompletion(tasks, sourceSha256, 'upload', result);
  for (const config of extraConnections) await client.request('connection/disconnect', config);
  result.passed = true;
  console.log('PASS WebDAV concurrency: 15 tasks, cancellation/retries, concurrent upload/download checksums and sampled RSS');
}

async function concurrentCompletion(tasks, sourceSha256, direction, result) {
  const upload = direction === 'upload';
  // Refill every slot before releasing the network gate, then let all queued work finish.
  const load = { tasks: tasks.length, bytesPerTask: size, baselineRssBytes: await residentBytes(client.process.pid),
    peakRssBytes: 0, samples: 0, runningSamples: 0, completed: 0, maxGrowthBytes: 128 * 1024 * 1024 };
  result[upload ? 'concurrentUploadCompletion' : 'concurrentCompletion'] = load;
  activeRule = proxy.arm(upload ? 'PUT' : 'GET', path => upload
    ? path.includes(`dbx-interruption-${runId}/dbx-upload-`)
    : path.endsWith(`dbx-interruption-${runId}/source.bin`));
  const finishing = [];
  for (const [index, task] of tasks.entries()) {
    const localPath = join(local, `complete-${index}.bin`);
    const uri = upload ? `${root}/concurrent-upload-${index}.bin` : sourceUri;
    if (upload) knownRemote.add(uri);
    const start = await client.request(`filesystem/transfer/start${upload ? 'Upload' : 'Download'}`,
      { ...task.owner, uri, localPath: upload ? source : localPath, overwrite: false, timeoutMs: 15000 });
    checkSnapshot(start, task.owner, direction, uri);
    finishing.push({ owner: task.owner, start, localPath, uri });
  }
  // Uploads serialize mutations per connection; downloads can use both connection slots.
  load.expectedBlockedStreams = upload ? extraConnections.length : 8;
  try { await activeRule.waitBlocked(load.expectedBlockedStreams); }
  catch (error) {
    load.gateStreams = activeRule.snapshots();
    load.gateTasks = [];
    for (const task of finishing) {
      const status = await client.request('filesystem/transfer/status', { ...task.owner, transferId: task.start.transferId });
      load.gateTasks.push({ state: status.state, bytesTransferred: status.bytesTransferred,
        errorCode: status.error?.data?.code });
    }
    throw error;
  }
  load.peakRssBytes = Math.max(load.baselineRssBytes, await residentBytes(client.process.pid));
  load.samples++;
  activeRule.disarm();
  const finishDeadline = performance.now() + 20000;
  for (;;) {
    const statuses = [];
    for (const task of finishing) {
      const status = await client.request('filesystem/transfer/status', { ...task.owner, transferId: task.start.transferId });
      checkSnapshot(status, task.owner, direction, task.uri);
      assert.ok(['queued', 'running', 'completed'].includes(status.state), `Concurrent ${direction} failed`);
      statuses.push(status);
    }
    load.peakRssBytes = Math.max(load.peakRssBytes, await residentBytes(client.process.pid));
    load.samples++;
    if (statuses.some(status => status.state === 'running')) load.runningSamples++;
    load.completed = statuses.filter(status => status.state === 'completed').length;
    if (load.completed === finishing.length) {
      assert.ok(statuses.every(status => status.bytesTransferred === size && status.totalBytes === size));
      break;
    }
    assert.ok(performance.now() < finishDeadline, `Concurrent ${direction}s did not complete`);
    await delay(10);
  }
  await activeRule.waitClosed();
  activeRule = undefined;
  assert.ok(load.runningSamples > 0, 'No in-flight RSS observation during concurrent completion');
  assert.ok(load.peakRssBytes - load.baselineRssBytes < load.maxGrowthBytes, 'Concurrent RSS growth exceeded 128 MiB');
  for (const task of finishing) {
    if (upload) {
      assert.equal((await request('stat', { uri: task.uri })).size, size);
      await successfulTransfer('download', task.uri, task.localPath);
    }
    assert.equal(await hashFile(task.localPath), sourceSha256);
    await rm(task.localPath);
    if (upload) {
      await request('delete', { uri: task.uri, recursive: false });
      knownRemote.delete(task.uri);
    }
  }
  load.sha256 = sourceSha256;
  assert.deepEqual(await readdir(local), ['source.bin'], 'Concurrent completion left temporary files');
}

const report = { runId, date: new Date().toISOString(), protocol: 'webdav',
  binarySha256: await hashFile(binary), harnessSha256: await hashFile(new URL(import.meta.url)),
  proxySha256: await hashFile(new URL('./transfer-proxy.mjs', import.meta.url)),
  sizeBytes: size, cases: [], passed: false, remoteCleaned: false, localCleaned: false, processClosed: false, proxyClosed: false };
try {
  const initialized = await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
  assert.equal(initialized.protocolVersion, 1);
  assert.equal((await client.request('connection/connect', lifecycle)).success, true);
  await request('createDirectory', { uri: root });
  created = true;
  await createSource();
  const sourceSha256 = await hashFile(source);
  await successfulTransfer('upload', sourceUri, source);
  assert.equal((await request('stat', { uri: sourceUri })).size, size);
  const seedCheck = join(local, 'seed-check.bin');
  await successfulTransfer('download', sourceUri, seedCheck);
  assert.equal(await hashFile(seedCheck), sourceSha256);
  await rm(seedCheck);
  for (const direction of ['upload', 'download']) {
    for (const mode of ['cancel', 'timeout', 'reset', 'disconnect']) {
      const row = { direction, mode, passed: false };
      report.cases.push(row);
      const destination = join(local, `${direction}-${mode}.bin`);
      const uri = direction === 'upload' ? `${root}/${mode}.bin` : sourceUri;
      if (direction === 'upload') {
        knownRemote.add(uri);
        await request('write', { uri, dataBase64: original.toString('base64'), create: true, overwrite: false });
      } else { await writeFile(destination, original, { flag: 'wx' }); }
      activeRule = proxy.arm(direction === 'upload' ? 'PUT' : 'GET', path => direction === 'upload'
        ? path.includes(`dbx-interruption-${runId}/dbx-upload-`)
        : path.endsWith(`dbx-interruption-${runId}/source.bin`));
      const start = await startTransfer(direction, uri, direction === 'upload' ? source : destination,
        mode === 'timeout' ? 1000 : 15000);
      row.transferId = start.transferId;
      await activeRule.waitBlocked();
      const running = await statusUntil(start, s => s.bytesTransferred > 0 || terminal.has(s.state));
      assert.equal(running.state, 'running', 'Transfer ended before in-flight fault injection');
      assert.ok(running.bytesTransferred > 0 && running.bytesTransferred < size);
      if (direction === 'download') assert.ok((await readdir(local)).some(name => name.startsWith('.dbx-download-')));
      if (mode === 'cancel') await request('transfer/cancel', { transferId: start.transferId });
      if (mode === 'reset') activeRule.reset();
      if (mode === 'disconnect') await client.request('connection/disconnect', lifecycle);
      const status = await statusUntil(start, s => terminal.has(s.state));
      row.state = status.state;
      row.bytesTransferred = status.bytesTransferred;
      row.errorCode = status.error?.data?.code;
      assert.equal(status.state, ['cancel', 'disconnect'].includes(mode) ? 'cancelled' : 'failed');
      assert.equal(row.errorCode, mode === 'timeout' ? 'timeout'
        : mode === 'reset' ? (direction === 'upload' ? 'backend' : 'transfer') : 'cancelled');
      const event = await client.waitEvent(e => e.method === 'filesystem/transfer/progress'
        && e.params?.transferId === start.transferId && terminal.has(e.params.state));
      assert.equal(event.params.state, status.state);
      row.proxyBeforeDrain = activeRule.snapshots();
      // A paused readable cannot observe EOF behind queued bytes; drain only after the terminal RPC state.
      activeRule.disarm();
      await activeRule.waitClosed();
      row.proxyStreams = activeRule.snapshots();
      assert.ok(row.proxyStreams.every(stream => (stream.sourceAborted || stream.socketDestroyed) && !stream.sourceComplete),
        'Interrupted HTTP body did not close before completion');
      activeRule = undefined;
      if (mode === 'disconnect') await client.request('connection/connect', lifecycle);
      if (direction === 'upload') {
        const retained = await request('read', { uri, maxBytes: 256 });
        assert.deepEqual(Buffer.from(retained.dataBase64, 'base64'), original);
      } else { assert.deepEqual(await readFile(destination), original); }
      assert.ok(!(await readdir(local)).some(name => name.startsWith('.dbx-download-')));
      const entries = (await request('list', { uri: root, limit: 100 })).entries;
      assert.ok(!entries.some(entry => entry.name.startsWith('dbx-upload-')), 'Temporary remote upload remained');
      await successfulTransfer(direction, uri, direction === 'upload' ? source : destination);
      if (direction === 'upload') await successfulTransfer('download', uri, destination);
      row.sha256 = await hashFile(destination);
      assert.equal(row.sha256, sourceSha256);
      await rm(destination);
      if (direction === 'upload') { await request('delete', { uri, recursive: false }); knownRemote.delete(uri); }
      row.passed = true;
      console.log(`PASS WebDAV ${direction} ${mode}: partial traffic, cleanup, original target and same-session retry`);
    }
  }
  await concurrentDownloads(sourceSha256);
  report.passed = true;
} catch (error) {
  report.failure = { name: error.name, code: error.code, message: error.message.slice(0, 300) };
  throw error;
} finally {
  try {
    if (created) {
      for (const config of extraConnections) await client.request('connection/disconnect', config);
      const tasks = (await request('transfer/list')).transfers;
      for (const task of tasks.filter(t => !terminal.has(t.state))) await request('transfer/cancel', { transferId: task.transferId });
      for (const task of tasks.filter(t => !terminal.has(t.state))) await statusUntil(task, s => terminal.has(s.state));
      activeRule?.disarm();
      activeRule = undefined;
      await client.request('connection/connect', lifecycle);
      for (const uri of knownRemote) {
        try { await request('delete', { uri, recursive: false }); }
        catch (error) { if (error.data?.code !== 'not_found') throw error; }
      }
      assert.deepEqual((await request('list', { uri: root, limit: 100 })).entries, []);
      await request('delete', { uri: root, recursive: false });
      await assert.rejects(request('stat', { uri: root }), error => error.data?.code === 'not_found');
      await client.request('connection/disconnect', lifecycle);
      report.remoteCleaned = true;
    }
  } finally {
    activeRule?.reset();
    activeRule?.disarm();
    await client.close();
    report.processClosed = true;
    await proxy.close();
    report.proxyClosed = true;
    await rm(local, { recursive: true, force: true });
    report.localCleaned = true;
    if (!report.remoteCleaned) report.passed = false;
    const evidence = new URL('../docs/evidence/', import.meta.url);
    await mkdir(evidence, { recursive: true });
    await writeFile(new URL(`transfer-interruption-${runId}.json`, evidence), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`Evidence: docs/evidence/transfer-interruption-${runId}.json`);
  }
}
