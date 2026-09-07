import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { sha256 } from 'js-sha256';
import { encode } from './bridge';
import { useManager } from './useManager';

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); });
async function setup(connectionId = 'a', ask = vi.fn().mockResolvedValue(null), handler?: (method: string, p: any) => any) {
  const bytes = new TextEncoder().encode('original');
  const invoke = vi.fn(async (method: string, p: any) => {
    const custom = handler?.(method, p);
    if (custom !== undefined) return custom;
    let value: any = {};
    if (method.endsWith('/capabilities')) value = { read: true, write: true, list: true, mkdir: true, upload: true, download: true };
    if (method.endsWith('/list')) value = { entries: [{ name: 'edit.txt', kind: 'file', uri: 'ftp:/edit.txt' }], transfers: [] };
    if (method.endsWith('/preview')) value = { token: 'snapshot', kind: 'text', size: bytes.length, digest: sha256(bytes) };
    if (method.endsWith('/previewChunk')) value = { dataBase64: encode(bytes), nextOffset: bytes.length };
    return { ok: true, value };
  });
  window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
  let manager!: ReturnType<typeof useManager>;
  wrappers.push(mount(defineComponent({ setup() { manager = useManager(ask); return () => h('div'); } })));
  await manager.initialize({ connectionId, providerId: 'plugin.ftp', connectionType: 'ftp' });
  return { manager, invoke, ask };
}
describe('file manager workflows', () => {
  it('loads a saved connection and navigates directories', async () => {
    const { manager: m, invoke } = await setup();
    expect(m.rows.value[0].name).toBe('edit.txt');
    await m.navigate('ftp:/folder/');
    expect(m.path.value).toBe('ftp:/folder/');
    expect(invoke.mock.calls.every(([, p]) => p.connectionId === 'a')).toBe(true);
  });
  it('previews text and chunks a 2 MiB edit beneath the host request limit', async () => {
    const { manager: m, invoke } = await setup();
    await m.open(m.rows.value[0]);
    expect(m.content.value).toBe('original');
    m.content.value = 'x'.repeat(2 * 1024 * 1024);
    await m.save();
    expect(m.dirty.value).toBe(false);
    const chunks = invoke.mock.calls.filter(([method]) => method.endsWith('/stageText'));
    expect(chunks).toHaveLength(4);
    expect(chunks.every(([, p]) => JSON.stringify(p).length < 2 * 1024 * 1024)).toBe(true);
  });
  it('keeps the draft when navigation confirmation is cancelled', async () => {
    const { manager: m, ask } = await setup();
    await m.open(m.rows.value[0]); m.content.value = 'draft';
    await m.navigate('ftp:/other/');
    expect(ask).toHaveBeenCalled(); expect(m.path.value).toBe('ftp:/'); expect(m.content.value).toBe('draft');
  });
  it('never silently overwrites a conflict', async () => {
    const { manager: m, invoke, ask } = await setup('a', vi.fn().mockResolvedValue(null), method => method.endsWith('/saveText') ? { ok: false, error: { message: 'changed', details: { code: 'conflict' } } } : undefined);
    await m.open(m.rows.value[0]); m.content.value = 'draft'; await m.save();
    expect(m.dirty.value).toBe(true); expect(ask).toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([method]) => method.endsWith('/saveText'))).toHaveLength(1);
  });
  it('does not save read-only connections and reports connection failure', async () => {
    const { manager: m, invoke } = await setup();
    await m.open(m.rows.value[0]); m.content.value = 'draft'; m.capabilities.value.write = false; await m.save();
    expect(invoke.mock.calls.some(([method]) => method.endsWith('/saveText'))).toBe(false);
    window.dbxPlugin!.invoke = vi.fn().mockResolvedValue({ ok: false, error: { details: { code: 'not_connected' } } });
    await m.refresh(); expect(m.error.value).toContain('连接已断开');
  });
  it('isolates drafts between mounted connection views', async () => {
    const a = await setup('a'); await a.manager.open(a.manager.rows.value[0]); a.manager.content.value = 'private draft';
    const b = await setup('b');
    expect(b.manager.content.value).toBe(''); expect(a.manager.content.value).toBe('private draft');
  });
});
