import { expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FileManager from './FileManager.vue';

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
  const wrapper = mount(FileManager, { global: { stubs: { FileName: true } }, props: { context: { connectionId: 'test', providerId: 'plugin.opendal', connectionType: 'opendal' } } });
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
