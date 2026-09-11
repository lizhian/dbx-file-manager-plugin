import { expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FileManager from './FileManager.vue';
import { sha256 } from 'js-sha256';

it('keeps the path input enabled and stable while a folder loads', async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(async (method: string, params: any) => {
    if (method.endsWith('/capabilities')) return { ok: true, value: { list: true } };
    if (method.endsWith('/list')) {
      if (params.uri === 'opendal:/folder/') return new Promise(resolve => { finish = resolve; });
      return { ok: true, value: { entries: [{ name: 'folder', uri: 'opendal:/folder/', kind: 'directory' }] } };
    }
    return { ok: true, value: { transfers: [] } };
  });
  window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
  const wrapper = mount(FileManager, { global: { stubs: { FileName: true, TextPreview: true } }, props: { context: { connectionId: 'test', providerId: 'plugin.opendal', connectionType: 'opendal' } } });
  try {
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('[aria-label="存储路径"]').element;
    await wrapper.get('[aria-label="展开文件夹"]').trigger('click');
    await flushPromises();
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(wrapper.get('[aria-label="存储路径"]').element).toBe(input);
    finish({ ok: true, value: { entries: [] } });
    await flushPromises();
    expect(input.readOnly).toBe(false);
    await wrapper.get('[aria-label="折叠文件夹"]').trigger('click');
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('/');
  } finally { wrapper.unmount(); }
});

it.each(['opendal', 'ftp', 'sftp', 's3', 'webdav', 'webhdfs', 'hdfs-native'])('uses the same known-file access UI for %s without a listing capability', async connectionType => {
  const invoke = vi.fn(async (method: string, params: any) => {
    if (method.endsWith('/capabilities')) return { ok: true, value: { rootUri: 'opendal:/', list: false, read: true, download: true } };
    if (method.endsWith('/preview')) return { ok: true, value: { token: 'snapshot', kind: 'text', size: 0, digest: sha256(''), editable: false } };
    return { ok: true, value: { transfers: [] } };
  });
  window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
  const wrapper = mount(FileManager, { global: { stubs: { FileName: true, TextPreview: true } }, props: { context: { connectionId: 'test', providerId: `plugin.${connectionType}`, connectionType } } });
  try {
    await flushPromises();
    expect(wrapper.text()).toContain('请输入已知文件路径');
    await wrapper.get('[aria-label="存储路径"]').setValue('/folder/中文.txt');
    expect(wrapper.find('[aria-label="预览路径中的文件"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="下载路径中的文件"]').exists()).toBe(false);
    await wrapper.get('[aria-label="存储路径"]').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const request = invoke.mock.calls.find(([method]) => method.endsWith('/preview'));
    expect(request?.[1].uri).toBe('opendal:/folder/%E4%B8%AD%E6%96%87.txt');
    expect(invoke.mock.calls.some(([method]) => method === 'workbench/list')).toBe(false);
    expect(wrapper.findAll('dialog[open]')).toHaveLength(0);
  } finally { wrapper.unmount(); }
});

it('resizes the preview with the separator and clamps its width', async () => {
  const invoke = vi.fn(async (method: string) => ({ ok: true, value: method.endsWith('/capabilities') ? { list: true, read: true } : method.endsWith('/preview') ? { token: 'preview', kind: 'text', size: 0, digest: sha256('') } : { entries: [{ name: 'a.txt', uri: 'opendal:/a.txt', kind: 'file' }], transfers: [] } }));
  window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
  const wrapper = mount(FileManager, { props: { context: { connectionId: 'test', providerId: 'plugin.s3' } }, global: { stubs: { FileName: true, TextPreview: true } } });
  try {
    await flushPromises();
    await wrapper.get('[data-file-entry-path]').trigger('dblclick'); await flushPromises();
    const separator = wrapper.get('[role="separator"]');
    const area = separator.element.parentElement!.parentElement!;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ right: 1000, width: 1000 } as DOMRect);
    Object.defineProperty(separator.element, 'setPointerCapture', { value: vi.fn() });
    const down = new Event('pointerdown', { bubbles: true }); Object.assign(down, { button: 0, pointerId: 1 }); separator.element.dispatchEvent(down);
    const move = new Event('pointermove', { bubbles: true }); Object.assign(move, { clientX: 400, pointerId: 1 }); separator.element.dispatchEvent(move);
    await flushPromises();
    expect(separator.attributes('aria-valuenow')).toBe('60');
    await separator.trigger('pointerup');
    await separator.trigger('keydown', { key: 'End' });
    await separator.trigger('keydown', { key: 'ArrowLeft' });
    expect(separator.attributes('aria-valuenow')).toBe('75');
    expect(wrapper.get('[aria-label="文件预览"]').attributes('style')).toContain('75%');
  } finally { wrapper.unmount(); }
});
