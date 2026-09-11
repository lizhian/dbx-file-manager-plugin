import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, watch } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import semver from 'semver';
import { Sidecar, protocolName } from './sidecar.mjs';
import { ConnectionStore, lifecyclePayload, providerFor, summary, validateRecord } from './connections.mjs';
import { readAsset } from './assets.mjs';
import { sandboxDocument } from './browser-bridge.mjs';

const BRIDGE_LIMIT = 2 * 1024 * 1024, UI_BINARY_LIMIT = 8 * 1024 * 1024;
function jsonSize(value) { return Buffer.byteLength(JSON.stringify(value) ?? 'null'); }
function requirePermission(manifest, permission) { if (!manifest.permissions?.includes(permission)) throw new Error(`Plugin permission required: ${permission}`); }

export async function createMockHost(options) {
  const project = resolve(options.project), manifest = JSON.parse(await readFile(resolve(project, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== undefined && manifest.manifest_version !== 1) throw new Error('Unsupported manifest version');
  // DBX uses Rust semver requirements, whose comparator separators include commas.
  if (manifest.engines?.host_api && !semver.satisfies('1.0.0', manifest.engines.host_api.replaceAll(',', ' '))) throw new Error('Plugin does not support Host API 1.0.0');
  if (manifest.entrypoints?.backend?.transport !== 'stdio-framed' || !manifest.entrypoints?.backend?.protocol_versions?.includes(1)) throw new Error('This mock host supports stdio-framed v1 only');
  const declaredRoot = resolve(project, manifest.entrypoints.ui.root || 'ui');
  const uiRoot = resolve(project, options.uiRoot || declaredRoot);
  const entry = relative(declaredRoot, resolve(project, manifest.entrypoints.ui.entry));
  await readAsset(uiRoot, entry);
  const store = new ConnectionStore(resolve(options.dataDir), manifest); await store.load();
  const sidecar = new Sidecar({ executable: resolve(project, options.backend), args: options.backendArgs || [], cwd: project, manifest });
  const connected = new Set(), frames = new Map(), sessions = new Map(), streams = new Set();
  let revision = 0, restarting = false, closing = false, origin;
  let lifecycleQueue = Promise.resolve();
  const serialize = action => { const task = lifecycleQueue.then(action); lifecycleQueue = task.catch(() => {}); return task; };
  const broadcast = (type, payload) => {
    const message = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
    for (const stream of streams) {
      if (stream.writableLength > 16 * 1024 * 1024) { stream.destroy(); streams.delete(stream); }
      else stream.write(message);
    }
  };
  sidecar.on('status', state => { if (state !== 'ready') connected.clear(); broadcast('status', { state }); });
  sidecar.on('event', event => { if (manifest.permissions?.includes('host.events')) broadcast('event', event); });
  sidecar.on('binary', event => { if (manifest.permissions?.includes('host.binary') && event.dataBase64.length <= UI_BINARY_LIMIT / 3 * 4 + 4) broadcast('binary', event); });
  await sidecar.start();

  const publicManifest = structuredClone(manifest);
  const translations = manifest.localizations?.['zh-CN'];
  if (translations) {
    publicManifest.name = translations.name || manifest.name;
    for (const contribution of publicManifest.contributions) {
      const translated = translations.contributions?.[contribution.id];
      if (!translated) continue;
      contribution.label = translated.label || contribution.label;
      contribution.description = translated.description || contribution.description;
      for (const f of contribution.fields || []) {
        const localized = translated.fields?.[f.key];
        if (localized) { f.label = localized.label || f.label; f.description = localized.description || f.description;
          for (const option of f.options || []) option.label = localized.options?.[option.value] || option.label; }
      }
    }
  }
  const listing = () => store.records.map(r => ({ ...summary(publicManifest, r), connected: connected.has(r.id) }));
  async function disconnect(id) {
    if (connected.has(id) && sidecar.state === 'ready') {
      await sidecar.request('connection/disconnect', lifecyclePayload(manifest, store.get(id)), 10000);
    }
    connected.delete(id);
  }
  async function connect(record) {
    if (restarting || sidecar.state !== 'ready') throw new Error('Backend is not ready; restart it first');
    const provider = providerFor(manifest, record.providerId);
    if (!provider.capabilities?.includes('connect')) throw new Error('Provider does not support connect');
    validateRecord(manifest, record);
    if (!connected.has(record.id)) {
      await sidecar.request('connection/connect', lifecyclePayload(manifest, record), 60000);
      connected.add(record.id);
    }
  }
  async function openFrame(session, connectionId, contributionId, suppliedContext) {
    const record = store.get(connectionId), provider = providerFor(manifest, record.providerId);
    const contribution = manifest.contributions.find(c => c.id === (contributionId || provider.workbench) && c.type === 'workbench');
    if (!contribution) throw new Error('Provider has no supported workbench');
    await connect(record);
    const context = { ...(suppliedContext || {}), connectionId: record.id, providerId: provider.id, connectionType: provider.database_type };
    if (jsonSize(context) > BRIDGE_LIMIT) throw new Error('Context exceeds limit');
    const existing = [...frames.values()].find(f => f.session === session.id && f.connectionId === connectionId && f.contributionId === contribution.id);
    if (existing) { existing.context = context; existing.name = summary(publicManifest, record).name; return expose(existing); }
    const frame = { id: randomUUID(), channel: randomUUID(), session: session.id, connectionId, contributionId: contribution.id, context, name: summary(publicManifest, record).name };
    frames.set(frame.id, frame); return expose(frame);
  }
  function expose(frame) { const { session, ...safe } = frame; return structuredClone(safe); }
  function frameFor(session, id) {
    const f = frames.get(id); if (!f || f.session !== session.id) throw new Error('Unknown workbench frame'); return f;
  }
  async function bridge(session, input) {
    const frame = frameFor(session, input.frameId), p = input.params || {};
    if (input.channel !== frame.channel) throw new Error('Stale workbench generation');
    if (input.method !== 'backend.sendBinary' && jsonSize(p) > BRIDGE_LIMIT) throw new Error('Bridge request exceeds 2 MiB');
    switch (input.method) {
      case 'host.getContext': return structuredClone(frame.context);
      case 'backend.invoke': {
        if (p.timeoutMs !== undefined && (typeof p.timeoutMs !== 'number' || !Number.isFinite(p.timeoutMs))) throw new Error('Invalid request timeout');
        const timeout = p.timeoutMs === undefined ? 30000 : Math.min(120000, Math.max(1, Math.round(p.timeoutMs)));
        return sidecar.request(protocolName(p.method), p.params ?? null, timeout);
      }
      case 'backend.notify': await sidecar.notify(protocolName(p.method), p.params ?? null); return null;
      case 'backend.sendBinary': {
        requirePermission(manifest, 'host.binary');
        if (typeof p.dataBase64 !== 'string' || p.dataBase64.length > Math.ceil(UI_BINARY_LIMIT / 3) * 4) throw new Error('Invalid base64 or binary exceeds limit');
        const data = Buffer.from(p.dataBase64, 'base64');
        if (data.toString('base64') !== p.dataBase64) throw new Error('Invalid base64');
        if (data.length > UI_BINARY_LIMIT) throw new Error('Bridge binary exceeds 8 MiB');
        await sidecar.sendBinary(p.channel, data); return null;
      }
      case 'ui.readAsset': {
        const prefix = (manifest.entrypoints.ui.root || 'ui').replace(/\/$/, '') + '/';
        const path = typeof p.path === 'string' && p.path.startsWith(prefix) ? p.path.slice(prefix.length) : p.path;
        return readAsset(uiRoot, path);
      }
      case 'host.openWorkbench': {
        requirePermission(manifest, 'host.workbench');
        return { mockHostOpenFrame: await serialize(() => openFrame(session, frame.connectionId, p.contributionId, p.context)) };
      }
      default: throw new Error(`Unsupported mock host method: ${input.method}`);
    }
  }
  async function api(session, route, p) {
    if (route === '/api/bridge') return bridge(session, p);
    if (route === '/api/frame-document') {
      const f = frameFor(session, p.frameId);
      f.channel = randomUUID();
      const asset = await readAsset(uiRoot, entry);
      return { ...expose(f), html: sandboxDocument(Buffer.from(asset.dataBase64, 'base64').toString('utf8'), f.channel) };
    }
    return serialize(async () => {
      switch (route) {
        case '/api/connections/edit': return store.get(p.id);
        case '/api/connections/save': {
          const existing = p.id ? store.get(p.id) : undefined;
          const record = validateRecord(manifest, p);
          if (existing && existing.providerId !== record.providerId) throw new Error('Create a new connection to change its provider');
          if (existing) await disconnect(existing.id);
          await store.replace([...store.records.filter(r => r.id !== record.id), record]);
          return { connections: listing(), id: record.id };
        }
        case '/api/connections/test': {
          const record = validateRecord(manifest, { ...p, id: randomUUID() });
          if (!providerFor(manifest, record.providerId).capabilities?.includes('test')) throw new Error('Provider does not support test');
          const result = await sidecar.request('connection/test', lifecyclePayload(manifest, record), 60000);
          return { ...result, message: Array.isArray(result?.warnings) && result.warnings.length ? result.warnings.join('\n') : '连接测试成功' };
        }
        case '/api/connections/connect': return { frame: await openFrame(session, p.id), connections: listing() };
        case '/api/connections/disconnect': await disconnect(p.id); return { connections: listing() };
        case '/api/connections/delete': {
          store.get(p.id); await disconnect(p.id);
          await store.replace(store.records.filter(r => r.id !== p.id));
          for (const f of frames.values()) if (f.connectionId === p.id) frames.delete(f.id);
          broadcast('frames-removed', { connectionId: p.id });
          return { connections: listing() };
        }
        case '/api/connections/import': {
          if (!Array.isArray(p.connections) || p.connections.length > 100) throw new Error('Invalid connection import');
          const imported = p.connections.map(r => validateRecord(manifest, { ...r, id: randomUUID() }));
          await store.replace([...store.records, ...imported]); return { connections: listing() };
        }
        case '/api/connections/import-preset': {
          if (!options.presetFile) throw new Error('No preset file configured');
          const preset = JSON.parse(await readFile(options.presetFile, 'utf8'));
          if (!Array.isArray(preset.connections) || preset.connections.length > 100) throw new Error('Invalid preset file');
          const imported = preset.connections.map(r => validateRecord(manifest, { ...r, id: randomUUID() }));
          await store.replace([...store.records, ...imported]); return { connections: listing() };
        }
        case '/api/frames/close': {
          const f = frameFor(session, p.id);
          if (![...frames.values()].some(other => other.id !== f.id && other.connectionId === f.connectionId)) await disconnect(f.connectionId);
          frames.delete(f.id); return { connections: listing() };
        }
        case '/api/backend/restart': {
          restarting = true;
          try {
            for (const id of [...connected]) await disconnect(id).catch(() => connected.delete(id));
            await sidecar.stop();
            if (options.buildBackend) await options.buildBackend();
            await sidecar.start();
            return { connections: listing(), state: sidecar.state };
          } finally { restarting = false; }
        }
        default: throw new Error('Unknown mock host endpoint');
      }
    });
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (request.headers.host !== new URL(origin).host) return respond(response, 403, { error: { message: 'Invalid Host' } });
      if (request.headers['sec-fetch-site'] === 'cross-site' || request.headers.origin && request.headers.origin !== origin) return respond(response, 403, { error: { message: 'Invalid Origin' } });
      const path = new URL(request.url, origin).pathname;
      const cookie = /(?:^|;\s*)mock_host_session=([a-f0-9]+)/.exec(request.headers.cookie || '')?.[1];
      let session = sessions.get(cookie);
      if (path === '/api/bootstrap' && request.method === 'GET') {
        if (!session) {
          if (sessions.size >= 128) throw new Error('Too many browser sessions');
          session = { id: randomBytes(24).toString('hex'), csrf: randomBytes(24).toString('hex') }; sessions.set(session.id, session);
          response.setHeader('Set-Cookie', `mock_host_session=${session.id}; HttpOnly; SameSite=Strict; Path=/`);
        }
        return respond(response, 200, { manifest: publicManifest, connections: listing(), csrf: session.csrf, state: sidecar.state, revision, hasPresets: !!options.presetFile });
      }
      if (path === '/api/events' && request.method === 'GET' && session) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        response.write(`data: ${JSON.stringify({ type: 'status', state: sidecar.state })}\n\n`); streams.add(response);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20000);
        response.on('close', () => { streams.delete(response); clearInterval(heartbeat); }); return;
      }
      if (path.startsWith('/api/')) {
        if (request.method !== 'POST' || !session || request.headers.origin !== origin || request.headers['x-mock-csrf'] !== session.csrf || !request.headers['content-type']?.startsWith('application/json')) {
          return respond(response, 403, { error: { message: 'Invalid browser session or request' } });
        }
        let bytes = 0; const chunks = [];
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) throw new Error('HTTP payload exceeds limit'); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return respond(response, 200, { value: await api(session, path, body) });
      }
      if (path === '/' && request.method === 'GET') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; media-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        return response.end(await readFile(options.shellHtml));
      }
      respond(response, 404, { error: { message: 'Not found' } });
    } catch (error) {
      const rpc = error.rpc;
      // Do not reflect raw filesystem/process errors, paths or request bodies.
      const message = error.code ? 'Local development service operation failed' : error.message;
      respond(response, 400, { error: { message, ...(rpc ? { code: rpc.code, data: rpc.data } : {}) } });
    }
  });
  server.requestTimeout = 320000;
  try { await new Promise((accept, reject) => {
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') { server.once('error', reject); server.listen(0, '127.0.0.1', accept); }
      else reject(error);
    });
    server.listen(options.port ?? 5190, '127.0.0.1', accept);
  }); } catch (error) { await sidecar.stop(); throw error; }
  origin = `http://127.0.0.1:${server.address().port}`;
  const watchStop = new AbortController();
  let debounce;
  void (async () => {
    try { for await (const event of watch(uiRoot, { signal: watchStop.signal, recursive: true })) {
      if (event.filename && resolve(uiRoot, event.filename) !== resolve(uiRoot, entry)) continue;
      clearTimeout(debounce); debounce = setTimeout(() => broadcast('ui-rebuilt', { revision: ++revision }), 200);
    } } catch (error) { if (error.name !== 'AbortError') broadcast('watch-error', {}); }
  })();
  return { origin, server, sidecar, store, async close() {
    if (closing) return; closing = true;
    watchStop.abort(); clearTimeout(debounce);
    for (const stream of streams) stream.end(); streams.clear();
    server.close();
    await serialize(async () => { for (const id of [...connected]) await disconnect(id).catch(() => {}); await sidecar.stop(); });
    server.closeAllConnections();
  } };
}
function respond(response, code, value) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
}
