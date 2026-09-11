import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export const JSON_LIMIT = 8 * 1024 * 1024;
export const BINARY_LIMIT = 64 * 1024 * 1024;
export function protocolName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) throw new Error('Invalid protocol name');
  return value;
}
export function frame(kind, payload) {
  const header = Buffer.alloc(5);
  header[0] = kind; header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}
export function binaryPayload(channel, data) {
  const name = Buffer.from(protocolName(channel));
  if (data.length > BINARY_LIMIT) throw new Error('Binary payload exceeds limit');
  const header = Buffer.alloc(2); header.writeUInt16BE(name.length);
  return Buffer.concat([header, name, data]);
}

export class FrameDecoder {
  buffer = Buffer.alloc(0);
  constructor(onFrame) { this.onFrame = onFrame; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 5) {
      const kind = this.buffer[0], length = this.buffer.readUInt32BE(1);
      if (![0, 1].includes(kind)) throw new Error('Unknown frame kind');
      if (length > (kind === 0 ? JSON_LIMIT : BINARY_LIMIT + 1024)) throw new Error('Frame exceeds limit');
      if (this.buffer.length < length + 5) return;
      const payload = this.buffer.subarray(5, length + 5);
      this.buffer = this.buffer.subarray(length + 5);
      if (kind === 0) this.onFrame({ kind, message: JSON.parse(payload.toString('utf8')) });
      else {
        if (payload.length < 2) throw new Error('Invalid binary frame');
        const size = payload.readUInt16BE(0);
        if (!size || size + 2 > payload.length) throw new Error('Invalid binary channel');
        const channel = protocolName(new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(2, 2 + size)));
        this.onFrame({ kind, channel, data: payload.subarray(2 + size) });
      }
    }
  }
}

export class Sidecar extends EventEmitter {
  pending = new Map();
  sequence = 0;
  state = 'stopped';
  constructor({ executable, args = [], cwd, manifest }) {
    super(); Object.assign(this, { executable, args, cwd, manifest });
  }
  async start() {
    if (this.child) throw new Error('Sidecar is already running');
    this.state = 'starting'; this.emit('status', this.state);
    const child = spawn(this.executable, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const decoder = new FrameDecoder(packet => {
      if (packet.kind === 1) return this.emit('binary', { channel: packet.channel, dataBase64: packet.data.toString('base64') });
      const message = packet.message;
      if (message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC message');
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id); clearTimeout(waiter.timer);
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message || 'Sidecar error'), { rpc: message.error }));
        else waiter.resolve(message.result);
      } else if (message.method) this.emit('event', { method: protocolName(message.method), params: message.params });
    });
    child.stdout.on('data', chunk => {
      try { decoder.push(chunk); } catch { this.fail('Invalid sidecar frame'); child.kill(); }
    });
    // Sidecar stderr may contain credentials. Consume it without copying it into HTTP or logs.
    child.stderr.resume();
    child.on('error', () => this.fail('Cannot start sidecar executable'));
    child.stdin.on('error', () => this.fail('Sidecar input closed'));
    child.on('exit', () => {
      this.child = undefined;
      if (this.state !== 'stopping') this.fail('Sidecar exited');
      else { this.state = 'stopped'; this.emit('status', this.state); }
    });
    try {
      const info = await this.request('plugin/initialize', { host: { protocolVersions: [1] } }, 10000);
      if (info?.protocolVersion !== 1 || info?.plugin?.id !== this.manifest.id || info?.plugin?.version !== this.manifest.version) {
        throw new Error('Sidecar identity or protocol does not match manifest');
      }
      this.state = 'ready'; this.emit('status', this.state); return info;
    } catch (error) { await this.stop(); this.fail(error.message); throw error; }
  }
  fail(message) {
    this.state = 'failed';
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)); }
    this.pending.clear(); this.emit('status', this.state);
  }
  write(kind, payload) {
    if (!this.child || !['starting', 'ready'].includes(this.state)) return Promise.reject(new Error('Sidecar is not ready'));
    if (kind === 0 && payload.length > JSON_LIMIT) return Promise.reject(new Error('JSON payload exceeds limit'));
    if (this.child.stdin.writableLength > 16 * 1024 * 1024) return Promise.reject(new Error('Sidecar input is busy'));
    return new Promise((resolve, reject) => this.child.stdin.write(frame(kind, payload), error => error ? reject(new Error('Sidecar write failed')) : resolve()));
  }
  request(method, params = null, timeoutMs = 30000) {
    protocolName(method);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid request timeout');
    if (this.pending.size >= 256) return Promise.reject(new Error('Too many pending requests'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Sidecar request timed out; operation may still be running')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write(0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))).catch(error => {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }
  notify(method, params) { return this.write(0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: protocolName(method), params }))); }
  sendBinary(channel, data) { return this.write(1, binaryPayload(channel, data)); }
  async stop() {
    const child = this.child;
    if (!child) return;
    if (!child.pid) { this.child = undefined; this.state = 'stopped'; return; }
    this.fail('Sidecar stopped'); this.state = 'stopping';
    await new Promise(resolve => {
      const terminate = setTimeout(() => child.kill('SIGTERM'), 2000);
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(terminate); clearTimeout(kill); resolve(); });
      child.stdin.end();
    });
  }
}
