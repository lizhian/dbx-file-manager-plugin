import { FrameDecoder, frame, binaryPayload } from '../sidecar.mjs';
const send = message => process.stdout.write(frame(0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }))));
const decoder = new FrameDecoder(packet => {
  if (packet.kind === 1) return process.stdout.write(frame(1, binaryPayload(packet.channel, packet.data)));
  const { id, method, params } = packet.message;
  if (method === 'plugin/initialize') return send({ id, result: { protocolVersion: 1, plugin: { id: 'example.echo', version: '1.0.0' } } });
  if (method === 'die') return process.exit(1);
  if (method === 'emit') return send({ method: 'example/event', params });
  if (method === 'fail') return send({ id, error: { code: -32000, message: 'Example failure', data: { category: 'example' } } });
  if (method === 'slow') return setTimeout(() => send({ id, result: params }), 80);
  if (id !== undefined) send({ id, result: method.startsWith('connection/') ? { success: true } : params });
});
process.stdin.on('data', data => decoder.push(data));
