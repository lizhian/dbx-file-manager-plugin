import { spawn } from 'node:child_process';

export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  if (payload.length > MAX_JSON_BYTES) throw new Error('JSON frame exceeds 8 MiB');
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];
    while (this.#buffer.length >= 5) {
      if (this.#buffer[0] !== 0) throw new Error('Unexpected non-JSON frame');
      const length = this.#buffer.readUInt32BE(1);
      if (!length || length > MAX_JSON_BYTES) throw new Error('Invalid JSON frame length');
      if (this.#buffer.length < length + 5) break;
      const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.#buffer.subarray(5, length + 5)));
      if (!message || message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC envelope');
      messages.push(message);
      this.#buffer = this.#buffer.subarray(length + 5);
    }
    return messages;
  }
  finish() {
    if (this.#buffer.length) throw new Error('Truncated sidecar frame');
  }
}

export class RpcError extends Error {
  constructor(method, error) {
    // Remote messages may contain endpoints or credentials. Never echo them in CI.
    const kind = typeof error.data?.code === 'string' && /^[a-z_]+$/.test(error.data.code) ? error.data.code : 'remote_error';
    super(`${method}: RPC ${Number(error.code)} (${kind}; remote detail withheld)`);
    this.code = error.code;
    this.data = error.data;
  }
}

export class FramedClient {
  #pending = new Map();
  #nextId = 1;
  #failure;
  #decoder = new FrameDecoder();
  #listeners = new Set();
  #eventRejectors = new Set();
  events = [];
  constructor(binary, { args = [], timeoutMs = 60000, env = process.env } = {}) {
    this.timeoutMs = timeoutMs;
    this.process = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = new Promise((resolve) => {
      this.process.once('close', (code, signal) => {
        try { this.#decoder.finish(); } catch (error) { this.#fail(error); }
        this.#fail(new Error('Sidecar closed'));
        resolve({ code, signal });
      });
    });
    this.process.once('error', () => this.#fail(new Error('Cannot start sidecar executable')));
    this.process.stdin.on('error', () => this.#fail(new Error('Sidecar stdin closed')));
    // Drain stderr without persisting or displaying possible secrets.
    this.process.stderr.resume();
    this.process.stdout.on('data', (chunk) => {
      try {
        for (const message of this.#decoder.push(chunk)) {
          if ('id' in message) {
            const pending = this.#pending.get(message.id);
            if (!pending) throw new Error('Unexpected response ID');
            if (('result' in message) === ('error' in message)) throw new Error('Invalid RPC response');
            clearTimeout(pending.timer);
            this.#pending.delete(message.id);
            if (message.error) pending.reject(new RpcError(pending.method, message.error));
            else pending.resolve(message.result);
          } else {
            if (typeof message.method !== 'string') throw new Error('Invalid notification');
            if (this.events.length >= 4096) throw new Error('Sidecar event limit exceeded');
            this.events.push(message);
            for (const listener of this.#listeners) listener(message);
          }
        }
      } catch (error) {
        this.#fail(error instanceof SyntaxError ? new Error('Malformed JSON frame') : error);
        this.process.kill('SIGTERM');
      }
    });
  }
  #fail(error) {
    this.#failure ??= error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.#failure);
    }
    this.#pending.clear();
    for (const reject of [...this.#eventRejectors]) reject(this.#failure);
  }
  request(method, params = {}) {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId++;
    const frame = encodeFrame({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(new Error(`${method}: timed out`));
        this.process.kill('SIGTERM');
      }, this.timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.process.stdin.write(frame);
    });
  }
  async waitEvent(predicate, timeoutMs = this.timeoutMs) {
    const existing = this.events.find(predicate);
    if (existing) return existing;
    if (this.#failure) throw this.#failure;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.#listeners.delete(listener); this.#eventRejectors.delete(onFailure); };
      const onFailure = (error) => { cleanup(); reject(error); };
      const listener = (event) => { if (predicate(event)) { cleanup(); resolve(event); } };
      const timer = setTimeout(() => onFailure(new Error('Transfer event timed out')), timeoutMs);
      this.#listeners.add(listener);
      this.#eventRejectors.add(onFailure);
    });
  }
  async close() {
    this.process.stdin.end();
    const terminate = setTimeout(() => this.process.kill('SIGTERM'), 1000);
    const kill = setTimeout(() => this.process.kill('SIGKILL'), 3000);
    try { return await this.closed; }
    finally { clearTimeout(terminate); clearTimeout(kill); }
  }
}
