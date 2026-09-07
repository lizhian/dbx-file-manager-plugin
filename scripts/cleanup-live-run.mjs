import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { FramedClient, RpcError } from './framed-client.mjs';
import { fixtureConnection, protocols } from './live-contract.mjs';

const [protocol, runId] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function main() {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/cleanup-live-run.mjs protocol run-uuid');
  assert.ok(protocols.includes(protocol) && uuid.test(runId), 'Exact protocol and run UUID required');
  const binary = process.env.DBX_FILE_MANAGER_BINARY;
  assert.ok(binary && isAbsolute(binary), 'Set absolute DBX_FILE_MANAGER_BINARY');
  const lifecycle = fixtureConnection(protocol, process.env, `cleanup-${runId}`);
  const scope = { providerId: `${lifecycle.provider.id}.files`, connectionId: lifecycle.connection.id };
  const root = `${protocol}:/dbx-plugin-contract-${runId}`;
  const client = new FramedClient(binary);
  let connected = false;
  try {
    await client.request('plugin/initialize', { host: { protocolVersions: [1], apiVersion: '1.1.0' } });
    await client.request('connection/connect', lifecycle);
    connected = true;
    const entries = [];
    let cursor;
    try {
      for (let pageNumber = 0; ; pageNumber++) {
        assert.ok(pageNumber < 10, 'Unexpected test-directory page count');
        const page = await client.request('filesystem/list', { ...scope, uri: root, limit: 100, ...(cursor ? { cursor } : {}) });
        entries.push(...page.entries);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      if (error instanceof RpcError && error.data?.code === 'not_found') {
        console.log(`Already absent: ${protocol} run ${runId}`);
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const name = entry.uri.slice(root.length + 1);
      const stageId = name.replace(/^\.?dbx-upload-/, '');
      assert.ok(entry.uri.startsWith(`${root}/`) && !name.includes('/') && entry.kind === 'file', 'Refusing unexpected test entry');
      assert.ok(['source.txt', 'copy.txt', 'renamed.txt', 'large.bin', 'empty-inline.txt', 'empty.bin'].includes(name)
        || (stageId !== name && uuid.test(stageId)), 'Refusing unknown test filename');
    }
    for (const entry of entries) await client.request('filesystem/delete', { ...scope, uri: entry.uri, recursive: false });
    await client.request('filesystem/delete', { ...scope, uri: root, recursive: false });
    console.log(`Cleaned exact test directory: ${protocol} run ${runId}`);
  } finally {
    try { if (connected) await client.request('connection/disconnect', lifecycle); }
    finally { await client.close(); }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
