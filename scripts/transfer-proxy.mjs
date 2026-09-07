import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Transform, pipeline } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitUntil(predicate, message, timeoutMs = 10000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, message);
    await delay(5);
  }
}

export async function transferProxy(endpoint, { writeNamespace } = {}) {
  assert.ok(writeNamespace === undefined || /^[a-z0-9-]+$/.test(writeNamespace), 'Invalid write namespace');
  let target;
  try { target = new URL(endpoint); }
  catch { throw new Error('Invalid loopback HTTP endpoint'); }
  assert.ok(target.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)
    && !target.username && !target.password && !target.search && !target.hash,
  'Transfer proxy accepts only credential-free loopback HTTP endpoints');
  const upstreams = new Set();
  let current;
  let origin;
  function gate(method, path, source) {
    if (!current || current.method !== method || !current.matches(path)) return undefined;
    const rule = current;
    const state = { forwardedBytes: 0, blocked: false, closed: false, released: false };
    let pending;
    const stream = new Transform({
      highWaterMark: 64 * 1024,
      transform(chunk, encoding, callback) {
        if (!state.released && state.forwardedBytes >= 64 * 1024) {
          state.blocked = true;
          pending = { chunk, callback };
          return;
        }
        state.forwardedBytes += chunk.length;
        callback(null, chunk);
      },
    });
    stream.once('close', () => { state.closed = true; pending = undefined; });
    rule.gates.push({ state, stream, source, release() {
      state.released = true;
      if (pending) {
        const { chunk, callback } = pending;
        pending = undefined;
        state.forwardedBytes += chunk.length;
        callback(null, chunk);
      }
    } });
    return stream;
  }
  const server = createServer((incoming, outgoing) => {
    if (!incoming.url.startsWith('/')) { outgoing.writeHead(400).end(); return; }
    // Origin-form HTTP paths can start with //; do not interpret them as a URL authority.
    let path;
    try { path = new URL(`${origin}${incoming.url}`).pathname; }
    catch { outgoing.writeHead(400).end(); return; }
    const inNamespace = path => !writeNamespace || path.split('/').includes(writeNamespace);
    if (!['GET', 'HEAD', 'OPTIONS', 'PROPFIND'].includes(incoming.method) && !inNamespace(path)) {
      outgoing.writeHead(403).end(); return;
    }
    const headers = { ...incoming.headers, host: target.host, connection: 'close' };
    // WebDAV COPY/MOVE destinations generated for the proxy must retain the backend's origin.
    if (headers.destination) {
      let destination;
      try { destination = new URL(headers.destination); } catch { outgoing.writeHead(400).end(); return; }
      if (destination.origin !== origin || destination.username || destination.password) { outgoing.writeHead(400).end(); return; }
      destination.protocol = target.protocol;
      destination.host = target.host;
      if (!inNamespace(destination.pathname)) { outgoing.writeHead(403).end(); return; }
      headers.destination = destination.href;
    }
    const upstream = request({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80,
      method: incoming.method, path: incoming.url, headers }, response => {
      outgoing.writeHead(response.statusCode, response.headers);
      const hold = incoming.method === 'GET' ? gate('GET', path, response) : undefined;
      pipeline(...[response, hold, outgoing].filter(Boolean), () => {});
    });
    upstreams.add(upstream);
    upstream.once('close', () => upstreams.delete(upstream));
    upstream.on('error', () => outgoing.destroy());
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
    const hold = incoming.method === 'PUT' ? gate('PUT', path, incoming) : undefined;
    pipeline(...[incoming, hold, upstream].filter(Boolean), error => { if (error) outgoing.destroy(); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint: new URL(target.pathname, origin).href,
    arm(method, matches) {
      assert.ok(!current, 'Disarm the previous proxy rule first');
      const rule = { method, matches, gates: [] };
      current = rule;
      return {
        snapshots: () => rule.gates.map(g => ({ ...g.state, sourceComplete: g.source.complete,
          sourceAborted: g.source.aborted, sourceEnded: g.source.readableEnded,
          queuedBytes: g.source.readableLength, socketDestroyed: g.source.socket?.destroyed })),
        waitBlocked: (count = 1) => waitUntil(() => rule.gates.filter(g => g.state.blocked).length >= count,
          'Expected in-flight HTTP body did not reach the pause point'),
        reset: () => { for (const g of rule.gates) g.stream.destroy(new Error('Injected transport reset')); },
        disarm() {
          if (current === rule) current = undefined;
          for (const g of rule.gates) g.release();
        },
        waitClosed: () => waitUntil(() => rule.gates.every(g => g.state.closed), 'Paused HTTP streams did not close'),
      };
    },
    async close() {
      current = undefined;
      for (const request of upstreams) request.destroy();
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}
