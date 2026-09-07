import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FramedClient } from './framed-client.mjs';
import { checkSnapshot, fixtureConnection, protocols } from './live-contract.mjs';

const exec = promisify(execFile);
const MiB = 1024 * 1024;
const terminal = new Set(['completed', 'cancelled', 'failed']);
const runId = randomUUID();
const pluginId = 'io.github.lizhian.file-manager';
const binary = process.env.DBX_FILE_MANAGER_BINARY;
const selected = (process.env.DBX_FM_PROTOCOLS ?? 'ftp,webdav').split(',');
assert.ok(binary && isAbsolute(binary), 'Set an absolute DBX_FILE_MANAGER_BINARY');
assert.ok(['darwin', 'linux'].includes(process.platform), 'RSS sampling requires macOS or Linux ps');
assert.ok(selected.length && new Set(selected).size === selected.length && selected.every(p => protocols.includes(p)), 'Invalid protocol selection');
await access(binary, constants.X_OK);

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function createSource(path, size) {
  const file = await open(path, 'wx', 0o600);
  try {
    const chunk = Buffer.alloc(256 * 1024, 0x6d);
    for (let written = 0; written < size;) {
      const result = await file.write(chunk, 0, Math.min(chunk.length, size - written));
      assert.ok(result.bytesWritten > 0);
      written += result.bytesWritten;
    }
  } finally { await file.close(); }
}

async function rss(pid) {
  const { stdout } = await exec('ps', ['-o', 'rss=', '-p', String(pid)]);
  const kb = Number(stdout.trim());
  assert.ok(Number.isSafeInteger(kb) && kb > 0, 'Missing sidecar RSS sample');
  return kb * 1024;
}

async function measuredTransfer(client, scope, direction, uri, path, size, measurements) {
  const baselineRssBytes = await rss(client.process.pid);
  const startMs = performance.now();
  const measurement = { direction, sizeBytes: size, baselineRssBytes,
    peakRssBytes: baselineRssBytes, sampleCount: 0, elapsedMs: 0, state: 'starting' };
  measurements.push(measurement);
  const start = await client.request(`filesystem/transfer/start${direction === 'upload' ? 'Upload' : 'Download'}`,
    { ...scope, uri, localPath: path, overwrite: false, timeoutMs: 120000 });
  checkSnapshot(start, scope, direction, uri);
  let previous = 0;
  for (;;) {
    measurement.peakRssBytes = Math.max(measurement.peakRssBytes, await rss(client.process.pid));
    measurement.sampleCount++;
    const status = await client.request('filesystem/transfer/status', { ...scope, transferId: start.transferId });
    checkSnapshot(status, scope, direction, uri);
    Object.assign(measurement, { elapsedMs: Math.round(performance.now() - startMs),
      state: status.state, bytesTransferred: status.bytesTransferred, totalBytes: status.totalBytes });
    if (status.error) {
      const code = value => typeof value === 'string' && /^[a-z_]{1,64}$/.test(value) ? value : 'unknown';
      measurement.error = { code: code(status.error.data?.code),
        cause: code(status.error.data?.recovery?.cause?.data?.code) };
    }
    assert.ok(status.bytesTransferred >= previous, 'Status progress decreased');
    previous = status.bytesTransferred;
    if (terminal.has(status.state)) {
      assert.equal(status.state, 'completed', `${direction} did not complete (remote detail withheld)`);
      assert.equal(status.bytesTransferred, size);
      assert.equal(status.totalBytes, size);
      assert.equal(status.error, null);
      break;
    }
    assert.ok(performance.now() - startMs < 140000, 'Transfer did not reach a terminal state');
    await delay(20);
  }
  await client.waitEvent(e => e.method === 'filesystem/transfer/progress'
    && e.params?.transferId === start.transferId && terminal.has(e.params.state));
  const events = client.events.filter(e => e.params?.transferId === start.transferId);
  previous = 0;
  for (const event of events) {
    checkSnapshot(event.params, scope, direction, uri);
    assert.ok(event.params.bytesTransferred >= previous, 'Event progress decreased');
    previous = event.params.bytesTransferred;
  }
  assert.equal(events.at(-1)?.params.state, 'completed');
  return measurement;
}

const report = { runId, date: new Date().toISOString(), platform: process.platform, arch: process.arch,
  binarySha256: await hashFile(binary), harnessSha256: await hashFile(new URL(import.meta.url)),
  sizesMiB: [16, 256], minimumSampleIntervalMs: 20,
  scope: 'Direct release sidecar, local protocol fixtures, sequential transfers. Not native UI or concurrent memory acceptance.',
  results: [], passed: false };
try {
  for (const protocol of selected) {
    const result = { protocol, transfers: [], remoteCleaned: false, localCleaned: false, processClosed: false };
    report.results.push(result);
    // Fresh process per protocol avoids hiding retained allocations behind a prior protocol's peak.
    const lifecycle = fixtureConnection(protocol, process.env, runId);
    const local = await mkdtemp(join(tmpdir(), 'dbx-transfer-resource-'));
    const client = new FramedClient(binary, { timeoutMs: 150000 });
    lifecycle.connection.query_timeout_secs = 120;
    const scope = { providerId: `${pluginId}.${protocol}.files`, connectionId: lifecycle.connection.id };
    const root = `${protocol}:/dbx-resource-${runId}`;
    const remoteFiles = [];
    const request = (method, params = {}) => client.request(`filesystem/${method}`, { ...scope, ...params });
    let connected = false;
    let created = false;
    try {
      const initialized = await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
      assert.equal(initialized.protocolVersion, 1);
      assert.equal(initialized.plugin.id, pluginId);
      assert.equal((await client.request('connection/connect', lifecycle)).success, true);
      connected = true;
      await request('createDirectory', { uri: root });
      created = true;
      for (const sizeMiB of report.sizesMiB) {
        const size = sizeMiB * MiB;
        const source = join(local, `source-${sizeMiB}`);
        const target = join(local, `target-${sizeMiB}`);
        const remote = `${root}/payload-${sizeMiB}`;
        await createSource(source, size);
        const expectedHash = await hashFile(source);
        remoteFiles.push(remote);
        await measuredTransfer(client, scope, 'upload', remote, source, size, result.transfers);
        assert.equal((await request('stat', { uri: remote })).size, size);
        await measuredTransfer(client, scope, 'download', remote, target, size, result.transfers);
        const receivedHash = await hashFile(target);
        assert.equal(receivedHash, expectedHash, 'Round-trip checksum mismatch');
        result.transfers.at(-1).sha256 = receivedHash;
        result.transfers.at(-2).sha256 = expectedHash;
        assert.deepEqual((await readdir(local)).sort(), [`source-${sizeMiB}`, `target-${sizeMiB}`].sort());
        await rm(source);
        await rm(target);
      }
      // The 240 MiB input increase must not produce comparable resident growth.
      for (const direction of ['upload', 'download']) {
        const [small, large] = result.transfers.filter(t => t.direction === direction);
        assert.ok(large.sampleCount >= 3, 'Insufficient samples to support resource comparison');
        assert.ok(large.peakRssBytes - small.peakRssBytes < 64 * MiB, `${protocol} ${direction}: RSS growth exceeds 64 MiB`);
      }
    } finally {
      try {
        if (created) {
          const tasks = (await request('transfer/list')).transfers;
          for (const task of tasks.filter(t => !terminal.has(t.state))) {
            await request('transfer/cancel', { transferId: task.transferId });
            const deadline = performance.now() + 30000;
            while (!terminal.has((await request('transfer/status', { transferId: task.transferId })).state)) {
              assert.ok(performance.now() < deadline, 'Active task did not stop; remote files retained');
              await delay(20);
            }
          }
          for (const uri of remoteFiles) await request('delete', { uri, recursive: false });
          const remaining = await request('list', { uri: root, limit: 100 });
          assert.deepEqual(remaining.entries, [], 'Remote temporary objects remain');
          await request('delete', { uri: root, recursive: false });
          result.remoteCleaned = true;
        }
      } finally {
        try { if (connected) await client.request('connection/disconnect', lifecycle); }
        finally {
          await client.close();
          result.processClosed = true;
          await rm(local, { recursive: true, force: true });
          result.localCleaned = true;
        }
      }
    }
    console.log(`PASS ${protocol}: 16/256 MiB bidirectional checksums, sampled RSS, progress and cleanup`);
  }
  report.passed = true;
} finally {
  const evidence = new URL('../docs/evidence/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  await writeFile(new URL(`transfer-resource-${runId}.json`, evidence), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Evidence: docs/evidence/transfer-resource-${runId}.json`);
}
