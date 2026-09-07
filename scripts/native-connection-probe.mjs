import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FramedClient } from './framed-client.mjs';

const [profile, ...binaries] = process.argv.slice(2);
assert.ok(profile && isAbsolute(profile) && /^dbx-native-profile-/.test(basename(profile)) && binaries.length);
assert.equal((await lstat(profile)).isSymbolicLink(), false);
const fixture = JSON.parse(await readFile(join(profile, 'fixture.json'), 'utf8'));
assert.match(fixture.run_id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runId = randomUUID();
const report = { runId, date: new Date().toISOString(), fixtureId: fixture.run_id, readOnly: true, cases: [], passed: false };
const pluginId = 'io.github.lizhian.file-manager';
try {
  for (const binary of binaries) {
    assert.ok(isAbsolute(binary));
    const row = { binary, sha256: sha(await readFile(binary)), checks: [], passed: false };
    report.cases.push(row);
    const client = new FramedClient(binary, { timeoutMs: 15000 });
    const lifecycle = {
      provider: { id: `${pluginId}.ftp`, databaseType: 'ftp' },
      connection: { id: `probe-${runId}`, name: 'Read-only native fixture probe', db_type: 'plugin',
        plugin_id: pluginId, plugin_connection_provider: `${pluginId}.ftp`, plugin_connection_type: 'ftp',
        host: '127.0.0.1', port: 2121, username: 'dbx', read_only: true,
        external_config: { root: `/ftp/dbx/dbx-native-${fixture.run_id}/` },
        connection_secrets: { password: 'dbx-password' }, idle_timeout_secs: 1, query_timeout_secs: 10 },
      runtime: { host: '127.0.0.1', port: 2121 },
    };
    const scope = { providerId: `${pluginId}.ftp.files`, connectionId: lifecycle.connection.id };
    async function read(stage) {
      const value = await client.request('filesystem/read', { ...scope, uri: 'ftp:/download-source.txt', maxBytes: 147457 });
      const bytes = Buffer.from(value.dataBase64, 'base64');
      assert.equal(bytes.length, 147456);
      assert.equal(sha(bytes), '817ecc1e00aa5730d600173a45336198952b6eb5ed2838ee8f83c4d9bcc2b83e');
      assert.equal(value.truncated, false);
      row.checks.push(stage);
    }
    try {
      const initialized = await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
      assert.equal(initialized.plugin.id, pluginId);
      row.version = initialized.plugin.version;
      assert.equal((await client.request('connection/connect', lifecycle)).success, true);
      await read('initial');
      await delay(1500);
      await read('after-idle-expiry');
      await client.request('connection/test', lifecycle);
      await read('after-connection-test');
      await client.request('connection/connect', lifecycle);
      await read('after-idempotent-connect');
      await client.request('connection/disconnect', lifecycle);
      await client.request('connection/connect', lifecycle);
      await read('after-disconnect-reconnect');
      await client.request('connection/disconnect', lifecycle);
      row.passed = true;
    } catch (error) {
      row.failure = error.message;
    } finally {
      row.processExit = await client.close();
    }
    console.log(`${row.passed ? 'PASS' : 'FAIL'} ${row.sha256}: ${row.checks.join(', ')}${row.failure ? `; ${row.failure}` : ''}`);
  }
  report.passed = report.cases.every(row => row.passed);
} finally {
  const folder = new URL('../docs/evidence/', import.meta.url);
  await mkdir(folder, { recursive: true });
  await writeFile(new URL(`native-connection-probe-${runId}.json`, folder), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Evidence: docs/evidence/native-connection-probe-${runId}.json`);
}
if (!report.passed) process.exitCode = 1;
