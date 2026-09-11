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
    if (method.endsWith('/capabilities')) value = { read: true, write: true, list: true, mkdir: true, rename: true, delete: true, upload: true, download: true };
    if (method.endsWith('/list')) value = { entries: [{ name: 'edit.txt', kind: 'file', uri: 'opendal:/edit.txt' }], transfers: [] };
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
  it('opens known paths without listing, reports unsupported operations, and blocks unsafe edits', async () => {
    const bytes = new TextEncoder().encode('original');
    const { manager: m, invoke, ask } = await setup('generic', undefined, method => {
      if (method.endsWith('/capabilities')) return { ok: true, value: { list: false, read: true, download: true, service: 'http' } };
      if (method.endsWith('/preview')) return { ok: true, value: { token: 'snapshot', kind: 'text', size: bytes.length, digest: sha256(bytes), editable: false } };
    });
    await m.initialize({ connectionId: 'generic', providerId: 'plugin.opendal', connectionType: 'opendal' });
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: '操作不支持' }));
    m.inputPath.value = '/folder/中文.txt';
    await m.accessPath('preview');
    expect(m.preview.value?.entry.uri).toBe('opendal:/folder/%E4%B8%AD%E6%96%87.txt');
    expect(m.content.value).toBe('original');
    expect(invoke.mock.calls.some(([method]) => method.endsWith('/list'))).toBe(false);
    m.content.value = 'changed'; await m.save();
    expect(invoke.mock.calls.some(([method]) => method.endsWith('/stageText'))).toBe(false);
    await m.mkdir();
    expect(invoke.mock.calls.some(([method]) => method.endsWith('/createDirectory'))).toBe(false);
    m.inputPath.value = 'http://outside/file'; await m.accessPath('preview');
    expect(m.error.value).toContain('不要输入服务 URL');
    m.inputPath.value = '/../secret'; await m.accessPath('preview');
    expect(m.error.value).toContain('名称不能为空');
  });
  it('keeps partial text previews read-only even if save is called directly', async () => {
    const bytes = new TextEncoder().encode('original');
    const { manager: m, invoke } = await setup('a', undefined, method => {
      if (method.endsWith('/preview')) return { ok: true, value: { token: 'snapshot', kind: 'text', size: bytes.length, digest: sha256(bytes), truncated: true } };
    });
    await m.open(m.rows.value[0]);
    expect(m.preview.value?.truncated).toBe(true);
    expect(m.content.value).toBe('original');
    m.content.value = 'partial edit';
    await m.save();
    expect(invoke.mock.calls.some(([method]) => /\/(stageText|saveText)$/.test(method))).toBe(false);
  });
  it('expands files inline, paginates children and preserves expansion on refresh', async () => {
    const directory = { name: 'folder', kind: 'directory', uri: 'opendal:/folder/' };
    const file = { name: 'child.txt', kind: 'file', uri: 'opendal:/folder/child.txt' };
    const { manager: m } = await setup('a', undefined, (method, p) => {
      if (!method.endsWith('/list')) return;
      return { ok: true, value: p.uri === 'opendal:/' ? { entries: [directory] } : p.cursor ? { entries: [{ ...file, name: 'next.txt', uri: 'opendal:/folder/next.txt' }] } : { entries: [file], nextCursor: 'page2' } };
    });
    await m.toggleTree(directory.uri);
    expect(m.path.value).toBe('opendal:/');
    expect(m.tableRows.value.map(r => [r.entry.name, r.depth, !!r.more])).toEqual([['folder', 0, false], ['child.txt', 1, false], ['folder', 1, true]]);
    await m.toggleTree(directory.uri, true);
    expect(m.tableRows.value.map(r => r.entry.name)).toEqual(['folder', 'child.txt', 'next.txt']);
    await m.refresh(); expect(m.expanded.value.has(directory.uri)).toBe(true);
    await m.toggleTree(directory.uri); expect(m.tableRows.value).toHaveLength(1);
    await m.navigate(directory.uri); expect(m.expanded.value.size).toBe(0);
  });
  it('renames and copies an expanded child in its own parent directory', async () => {
    const ask = vi.fn().mockResolvedValue('new.txt');
    const { manager: m, invoke } = await setup('a', ask);
    const child = { name: 'old.txt', kind: 'file', uri: 'opendal:/folder/old.txt' };
    m.selected.value = child; await m.rename();
    expect(invoke.mock.calls.find(([method]) => method.endsWith('/rename'))?.[1].targetUri).toBe('opendal:/folder/new.txt');
    m.selected.value = child; m.capabilities.value.copy = true; await m.copy();
    expect(invoke.mock.calls.find(([method]) => method.endsWith('/copy'))?.[1].targetUri).toBe('opendal:/folder/new.txt');
  });
  it('loads a saved connection and navigates directories', async () => {
    const { manager: m, invoke } = await setup();
    expect(m.rows.value[0].name).toBe('edit.txt');
    await m.navigate('opendal:/folder/');
    expect(m.path.value).toBe('opendal:/folder/');
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
    await m.navigate('opendal:/other/');
    expect(ask).toHaveBeenCalled(); expect(m.path.value).toBe('opendal:/'); expect(m.content.value).toBe('draft');
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
