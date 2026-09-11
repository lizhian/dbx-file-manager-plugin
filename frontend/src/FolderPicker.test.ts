import { expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FileManager from './FileManager.vue';
import FolderPicker from './FolderPicker.vue';

it('isolates picker expansion, loading and selection from the file list', async () => {
  const folder = { name: 'folder', kind: 'directory', uri: 'opendal:/folder/' };
  const file = { name: 'file.txt', kind: 'file', uri: 'opendal:/file.txt' };
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(async (method: string, params: any) => {
    if (method.endsWith('/capabilities')) return { ok: true, value: { list: true, rename: true } };
    if (method.endsWith('/list')) {
      if (params.uri === folder.uri) return new Promise(resolve => { finish = resolve; });
      return { ok: true, value: { entries: [folder, file] } };
    }
    return { ok: true, value: { transfers: [] } };
  });
  window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
  const wrapper = mount(FileManager, { global: { stubs: { FileName: true } }, props: { context: { connectionId: 'test', providerId: 'plugin.opendal', connectionType: 'opendal' } } });
  try {
    await flushPromises();
    const mainFolder = wrapper.get('[data-file-entry-path="opendal:/folder/"]');
    await wrapper.get('[data-file-entry-path="opendal:/file.txt"] [aria-label="编辑"]').trigger('click');
    await flushPromises();
    const picker = wrapper.getComponent(FolderPicker);
    await picker.get('[aria-label="展开文件夹"]').trigger('click');
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[aria-label="存储路径"]').element.readOnly).toBe(false);
    expect(mainFolder.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
    finish({ ok: true, value: { entries: [{ name: 'child', kind: 'directory', uri: 'opendal:/folder/child/' }] } });
    await flushPromises();
    expect(picker.findAll('[aria-expanded="true"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-file-entry-path]')).toHaveLength(2);
    await picker.get('[title="folder"]').trigger('click');
    expect(picker.get('[title="folder"]').attributes('aria-pressed')).toBe('true');
    expect(mainFolder.attributes('aria-selected')).toBe('false');
    await picker.findAll('[aria-label="折叠文件夹"]')[1].trigger('click');
    expect(mainFolder.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
  } finally { wrapper.unmount(); }
});

it('keeps pagination and retry state local and reloads on reopening', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ entries: [], nextCursor: 'next' }).mockResolvedValue({ entries: [{ name: 'child', kind: 'directory', uri: 'opendal:/child/' }] });
  const options = { props: { root: 'opendal:/', modelValue: 'opendal:/', load }, global: { stubs: { FileName: true } } };
  const wrapper = mount(FolderPicker, options);
  try {
    await flushPromises();
    await wrapper.get('.text-error').trigger('click');
    await flushPromises();
    const more = wrapper.findAll('button').find(button => button.text() === '加载更多')!;
    await more.trigger('click');
    await flushPromises();
    expect(load).toHaveBeenLastCalledWith('opendal:/', 'next');
    expect(wrapper.find('[title="child"]').exists()).toBe(true);
  } finally { wrapper.unmount(); }
  const reopened = mount(FolderPicker, options);
  try { await flushPromises(); expect(load).toHaveBeenLastCalledWith('opendal:/', undefined); }
  finally { reopened.unmount(); }
});
