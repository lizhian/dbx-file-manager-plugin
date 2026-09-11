import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { JSDOM } from 'jsdom';
import { sandboxDocument } from '../browser-bridge.mjs';
import { hostMessage } from '../ui/messages.js';

test('host messages snapshot nested reactive context and permissions before postMessage', () => {
  const source = reactive({ context: { connectionId: 'one' }, permissions: ['host.events'] });
  const message = hostMessage('generation', { type: 'init', ...source });
  assert.doesNotThrow(() => structuredClone(message));
  source.context.connectionId = 'two'; source.permissions.push('host.binary');
  assert.equal(message.context.connectionId, 'one'); assert.deepEqual(message.permissions, ['host.events']);
});
test('sandbox bootstrap handles initialization, generation filtering and context listeners', async () => {
  const dom = new JSDOM(sandboxDocument('<html><head></head><body></body></html>', 'generation'), { runScripts: 'dangerously' });
  const w = dom.window, send = value => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: value }));
  send(hostMessage('generation', { type: 'init', context: { connectionId: 'one' }, locale: 'zh-CN' }));
  await w.dbxPlugin.ready; assert.equal(w.dbxPlugin.context.connectionId, 'one');
  let calls = 0; const off = w.dbxPlugin.onContext(() => calls++);
  send(hostMessage('old', { type: 'context', context: { connectionId: 'bad' } }));
  assert.equal(w.dbxPlugin.context.connectionId, 'one');
  send(hostMessage('generation', { type: 'context', context: { connectionId: 'two' } }));
  assert.equal(calls, 1); off();
  send(hostMessage('generation', { type: 'context', context: { connectionId: 'three' } })); assert.equal(calls, 1);
  dom.window.close();
});
