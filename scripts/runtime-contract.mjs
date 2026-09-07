import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { FramedClient, RpcError } from './framed-client.mjs';
import { fixtureConnection, checkCapabilities } from './live-contract.mjs';

const runId = randomUUID();
async function main() {
  const binary = process.env.DBX_FILE_MANAGER_BINARY;
  assert.ok(binary && isAbsolute(binary), 'Set absolute DBX_FILE_MANAGER_BINARY');
  const lifecycle = fixtureConnection('ftp', process.env, runId);
  // Existing host ConnectionConfig fields, deliberately outside external_config.
  lifecycle.connection.query_timeout_secs = 0;
  lifecycle.connection.idle_timeout_secs = 1;
  const root = `ftp:/dbx-plugin-contract-${runId}`;
  const files = [`${root}/source.txt`, `${root}/copy.txt`];
  const scope = { providerId: `${lifecycle.provider.id}.files`, connectionId: lifecycle.connection.id };
  const client = new FramedClient(binary);
  const request = (method, params = {}) => client.request(`filesystem/${method}`, { ...scope, ...params });
  let connected = false;
  let created = false;
  try {
    await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
    const connections = await Promise.allSettled([
      client.request('connection/connect', lifecycle), client.request('connection/connect', lifecycle),
    ]);
    connected = connections.some((result) => result.status === 'fulfilled');
    for (const result of connections) {
      assert.equal(result.status, 'fulfilled', 'Concurrent first-connect must deduplicate');
      assert.equal(result.value.success, true);
    }
    assert.equal((await client.request('connection/connect', lifecycle)).success, true);
    assert.equal((await request('createDirectory', { uri: root })).success, true);
    created = true;
    for (const uri of files) {
      assert.equal((await request('write', { uri, dataBase64: 'b2s=', create: true, overwrite: false })).success, true);
    }
    const page = await request('list', { uri: root, limit: 1 });
    assert.equal(typeof page.nextCursor, 'string');
    const readonly = structuredClone(lifecycle);
    readonly.connection.read_only = true;
    assert.equal((await client.request('connection/connect', readonly)).success, true);
    checkCapabilities(await request('capabilities'), ['read'], ['write', 'delete', 'upload']);
    await assert.rejects(request('delete', { uri: files[0] }), (error) => error instanceof RpcError && error.data?.code === 'read_only');
    await assert.rejects(request('list', { uri: root, cursor: page.nextCursor, limit: 1 }),
      (error) => error instanceof RpcError && error.data?.code === 'invalid_cursor');
    await delay(1500);
    assert.equal((await request('read', { uri: files[0] })).dataBase64, 'b2s=', 'Idle expiry must reconnect transparently');
    const eager = structuredClone(lifecycle);
    eager.connection.idle_timeout_secs = 0;
    assert.equal((await client.request('connection/connect', eager)).success, true);
    assert.equal((await request('read', { uri: files[1] })).dataBase64, 'b2s=');
    assert.equal((await request('read', { uri: files[1] })).dataBase64, 'b2s=');
    console.log('PASS FTP runtime gates: concurrent/same-config connect, changed readonly generation, stale cursor rejection, idle resume, query=0 and idle=0 operation acceptance.');
    console.log('Actual query-timeout expiration and eviction internals require backend deterministic tests; this smoke does not infer them from latency.');
  } finally {
    try {
      if (connected) {
        await client.request('connection/disconnect', lifecycle);
        await client.request('connection/connect', lifecycle);
        if (created) {
          for (const uri of files) {
            try { await request('delete', { uri, recursive: false }); }
            catch (error) { if (!(error instanceof RpcError && error.data?.code === 'not_found')) throw error; }
          }
          await request('delete', { uri: root, recursive: false });
        }
        await client.request('connection/disconnect', lifecycle);
      }
    } finally { await client.close(); }
  }
}
main().catch((error) => { console.error(`FTP runtime run ${runId}: ${error.message}`); process.exitCode = 1; });
