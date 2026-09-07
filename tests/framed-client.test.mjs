import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, FrameDecoder, FramedClient, RpcError, MAX_JSON_BYTES } from '../scripts/framed-client.mjs';
const message = { jsonrpc: '2.0', id: 1, result: { success: true } };
test('SDK framing is kind zero plus big-endian length and UTF-8 JSON', () => {
  const frame = encodeFrame(message);
  assert.equal(frame[0], 0);
  assert.equal(frame.readUInt32BE(1), frame.length - 5);
  assert.deepEqual(new FrameDecoder().push(frame), [message]);
});
test('decoder accepts every byte boundary and coalesced frames', () => {
  const frame = encodeFrame(message);
  for (let split = 1; split < frame.length; split++) {
    const decoder = new FrameDecoder();
    assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
    assert.deepEqual(decoder.push(frame.subarray(split)), [message]);
    decoder.finish();
  }
  assert.deepEqual(new FrameDecoder().push(Buffer.concat([frame, frame])), [message, message]);
});
test('decoder fails closed on binary, oversize, malformed or truncated frames', () => {
  const binary = Buffer.from([1, 0, 0, 0, 1, 0]);
  assert.throws(() => new FrameDecoder().push(binary));
  const large = Buffer.alloc(5); large.writeUInt32BE(MAX_JSON_BYTES + 1, 1);
  assert.throws(() => new FrameDecoder().push(large));
  assert.throws(() => new FrameDecoder().push(Buffer.from([0, 0, 0, 0, 1, 123])));
  const decoder = new FrameDecoder(); decoder.push(encodeFrame(message).subarray(0, 7));
  assert.throws(() => decoder.finish());
});
test('RPC errors withhold remote messages while retaining structured codes', () => {
  const error = new RpcError('filesystem/write', { code: -32000, message: 'credential-canary', data: { code: 'already_exists' } });
  assert.doesNotMatch(error.message, /credential-canary/);
  assert.match(error.message, /already_exists/);
  assert.equal(error.data.code, 'already_exists');
});
test('real subprocess roundtrip uses the framed transport', async () => {
  const client = new FramedClient(process.execPath, { args: ['--input-type=module', '-e', `
    import { FrameDecoder, encodeFrame } from ${JSON.stringify(new URL('../scripts/framed-client.mjs', import.meta.url).href)};
    const decoder = new FrameDecoder();
    process.stdin.on('data', chunk => { for (const request of decoder.push(chunk)) {
      process.stdout.write(encodeFrame({jsonrpc:'2.0', id:request.id, result:request.params}));
    }});
  `], timeoutMs: 2000 });
  try { assert.deepEqual(await client.request('test/echo', { value: 42 }), { value: 42 }); }
  finally { await client.close(); }
});
test('timeouts reject and reap a silent subprocess', async () => {
  const client = new FramedClient(process.execPath, { args: ['-e', 'process.stdin.resume()'], timeoutMs: 50 });
  try { await assert.rejects(client.request('test/timeout'), /timed out/); }
  finally { await client.close(); }
});
test('sidecar exit rejects transfer event waits immediately', async () => {
  const client = new FramedClient(process.execPath, { args: ['-e', 'process.exit(0)'], timeoutMs: 10000 });
  try { await assert.rejects(client.waitEvent(() => false), /Sidecar closed/); }
  finally { await client.close(); }
});
