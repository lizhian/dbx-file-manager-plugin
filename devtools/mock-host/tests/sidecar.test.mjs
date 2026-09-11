import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { FrameDecoder, frame, binaryPayload, Sidecar, JSON_LIMIT } from '../sidecar.mjs';

const config = { executable: process.execPath, args: [fileURLToPath(new URL('./echo-sidecar.mjs', import.meta.url))], manifest: { id: 'example.echo', version: '1.0.0' } };
test('decoder handles split headers, payloads, concatenated frames and binary channels', () => {
  const got = [], decoder = new FrameDecoder(packet => got.push(packet));
  const input = Buffer.concat([frame(0, Buffer.from('{"result":1}')), frame(1, binaryPayload('test/bytes', Buffer.from([0, 255, 13])))]);
  for (const byte of input) decoder.push(Buffer.from([byte]));
  assert.equal(got[0].message.result, 1); assert.deepEqual(got[1].data, Buffer.from([0, 255, 13]));
  assert.equal(decoder.buffer.length, 0);
});
test('decoder rejects oversized and malformed frames before allocating payloads', () => {
  const header = Buffer.alloc(5); header.writeUInt32BE(JSON_LIMIT + 1, 1);
  assert.throws(() => new FrameDecoder(() => {}).push(header), /limit/);
  assert.throws(() => new FrameDecoder(() => {}).push(frame(9, Buffer.alloc(0))), /kind/);
  assert.throws(() => new FrameDecoder(() => {}).push(frame(1, Buffer.from([0, 20]))), /channel/);
});
test('generic sidecar correlates out-of-order replies and preserves structured errors', async t => {
  const sidecar = new Sidecar(config); t.after(() => sidecar.stop()); await sidecar.start();
  const order = [];
  const a = sidecar.request('slow', { a: 1 }).then(value => { order.push('slow'); return value; });
  const b = sidecar.request('echo', { b: 2 }).then(value => { order.push('fast'); return value; });
  assert.deepEqual(await b, { b: 2 }); assert.deepEqual(await a, { a: 1 }); assert.deepEqual(order, ['fast', 'slow']);
  await assert.rejects(sidecar.request('fail'), e => e.rpc.data.category === 'example');
});
test('events, binary, timeout and process death are observable without business RPC knowledge', async t => {
  const sidecar = new Sidecar(config); t.after(() => sidecar.stop()); await sidecar.start();
  const event = once(sidecar, 'event'); await sidecar.notify('emit', { event: true }); assert.equal((await event)[0].params.event, true);
  const binary = once(sidecar, 'binary'); await sidecar.sendBinary('channel', Buffer.from('bytes')); assert.equal((await binary)[0].dataBase64, Buffer.from('bytes').toString('base64'));
  await assert.rejects(sidecar.request('slow', {}, 5), /timed out/);
  const slow = sidecar.request('slow'); const slowAssertion = assert.rejects(slow, /exited/);
  await sidecar.notify('die'); await slowAssertion; assert.equal(sidecar.pending.size, 0);
});
test('handshake rejects wrong identity and missing executables terminate promptly', async () => {
  const wrong = new Sidecar({ ...config, manifest: { id: 'wrong', version: '1.0.0' } });
  await assert.rejects(wrong.start(), /identity/);
  const missing = new Sidecar({ ...config, executable: '/definitely/missing/mock-sidecar' });
  await assert.rejects(missing.start(), /start/); await missing.stop();
});
