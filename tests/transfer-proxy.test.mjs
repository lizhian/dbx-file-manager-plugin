import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { transferProxy } from '../scripts/transfer-proxy.mjs';

async function fixture(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`,
    async close() { const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed; } };
}

function fetchBody(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, async response => {
      try {
        const chunks = [];
        for await (const chunk of response) chunks.push(chunk);
        resolve(Buffer.concat(chunks));
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('transfer proxy rejects nonlocal targets and embedded credentials', async () => {
  for (const url of ['https://127.0.0.1', 'http://example.com', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/?secret=x']) {
    await assert.rejects(transferProxy(url));
  }
  await assert.rejects(transferProxy('invalid endpoint with private-value'), error => !error.message.includes('private-value'));
});

test('proxy treats double-slash origin-form requests as paths, not authorities', async () => {
  const backend = await fixture((req, res) => res.end(req.url));
  const proxy = await transferProxy(backend.url);
  try {
    assert.equal((await fetchBody(`${proxy.endpoint}/`, 'PROPFIND')).toString(), '//');
    assert.equal((await fetchBody(`${proxy.endpoint}/payload`, 'GET')).toString(), '//payload');
  } finally { await proxy.close(); await backend.close(); }
});

test('proxy rejects writes and MOVE destinations outside the isolated test namespace', async () => {
  const paths = [];
  const backend = await fixture((req, res) => { paths.push(req.url); res.end('forwarded'); });
  const proxy = await transferProxy(backend.url, { writeNamespace: 'test-run' });
  try {
    assert.equal((await fetchBody(`${proxy.endpoint}unrelated`, 'DELETE')).length, 0);
    assert.equal((await fetchBody(`${proxy.endpoint}test-run/source`, 'MOVE', undefined,
      { destination: `${proxy.endpoint}unrelated` })).length, 0);
    assert.deepEqual(paths, []);
    assert.equal((await fetchBody(`${proxy.endpoint}/test-run/directory`, 'MKCOL')).toString(), 'forwarded');
    assert.deepEqual(paths, ['//test-run/directory']);
  } finally { await proxy.close(); await backend.close(); }
});

for (const method of ['PUT', 'GET']) {
  test(`proxy ${method} forwards some bytes then pauses and releases without truncation`, async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 17);
    const backend = await fixture(async (req, res) => {
      try {
        if (req.method === 'PUT') {
          let received = 0;
          for await (const chunk of req) received += chunk.length;
          res.end(String(received));
        } else { res.end(bytes); }
      } catch { res.destroy(); }
    });
    const proxy = await transferProxy(backend.url);
    try {
      const rule = proxy.arm(method, path => path === '/payload');
      const pending = fetchBody(`${proxy.endpoint}payload`, method, method === 'PUT' ? bytes : undefined);
      pending.catch(() => {});
      await rule.waitBlocked();
      assert.ok(rule.snapshots()[0].forwardedBytes >= 64 * 1024);
      assert.ok(rule.snapshots()[0].forwardedBytes < bytes.length);
      rule.disarm();
      const result = await pending;
      if (method === 'PUT') assert.equal(result.toString(), String(bytes.length));
      else assert.deepEqual(result, bytes);
      await rule.waitClosed();
    } finally { await proxy.close(); await backend.close(); }
  });
}

test('proxy resets a paused response and rewrites only its own WebDAV destinations', async () => {
  const backend = await fixture((req, res) => {
    if (['COPY', 'MOVE'].includes(req.method)) res.end(req.headers.destination);
    else res.end(Buffer.alloc(2 * 1024 * 1024, 19));
  });
  const proxy = await transferProxy(backend.url);
  try {
    const copied = await fetchBody(`${proxy.endpoint}source`, 'COPY', undefined, { destination: `${proxy.endpoint}target` });
    assert.equal(copied.toString(), `${backend.url}/target`);
    const doubleSlash = await fetchBody(`${proxy.endpoint}source`, 'MOVE', undefined,
      { destination: `${proxy.endpoint}/target` });
    assert.equal(doubleSlash.toString(), `${backend.url}//target`);
    const rule = proxy.arm('GET', () => true);
    const rejected = assert.rejects(fetchBody(`${proxy.endpoint}payload`, 'GET'));
    await rule.waitBlocked();
    rule.reset();
    await rejected;
    await rule.waitClosed();
    rule.disarm();
  } finally { await proxy.close(); await backend.close(); }
});

test('proxy closes a paused upload when the client socket closes after its request body', async () => {
  const backend = await fixture(async (req, res) => {
    try { for await (const chunk of req) { void chunk; } res.end('complete'); }
    catch { res.destroy(); }
  });
  const proxy = await transferProxy(backend.url);
  let upload;
  try {
    const rule = proxy.arm('PUT', () => true);
    const pending = new Promise((resolve, reject) => {
      upload = request(proxy.endpoint, { method: 'PUT' }, resolve);
      upload.on('error', reject);
      upload.end(Buffer.alloc(3 * 64 * 1024, 23));
    });
    const rejected = assert.rejects(pending);
    await rule.waitBlocked();
    upload.destroy(new Error('Client cancelled upload'));
    await rejected;
    await rule.waitClosed();
    rule.disarm();
  } finally { upload?.destroy(); await proxy.close(); await backend.close(); }
});
