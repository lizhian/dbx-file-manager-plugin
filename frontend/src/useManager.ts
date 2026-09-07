import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { sha256 } from 'js-sha256';
import { childUri, client, decode, encode, parentUri, RpcError, sortEntries, type Client, type Context, type Entry, type Transfer } from './bridge';

export interface Question { title: string; message?: string; value?: string; danger?: boolean; confirm?: string }
export type Ask = (question: Question) => Promise<string | null>;
const CHUNK = 512 * 1024;
const terminal = (t: Transfer) => ['completed', 'failed', 'cancelled'].includes(t.state);

export function useManager(ask: Ask) {
  const path = ref('');
  const inputPath = ref('');
  const root = ref('');
  const entries = ref<Entry[]>([]);
  const cursor = ref<string>();
  const selected = ref<Entry>();
  const capabilities = ref<Record<string, any>>({});
  const busy = ref(false);
  const error = ref('');
  const status = ref('');
  const filter = ref('');
  const order = ref<'name' | 'size'>('name');
  const tree = ref<Record<string, Entry[]>>({});
  const expanded = ref(new Set<string>());
  const transfers = ref<Transfer[]>([]);
  const preview = shallowRef<{ token: string; entry: Entry; kind: string; url?: string }>();
  const content = ref('');
  const original = ref('');
  const dirty = computed(() => content.value !== original.value);
  const rows = computed(() => sortEntries(entries.value.filter(e => e.name.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())), order.value));
  let api: Client;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function message(e: unknown) {
    const codes: Record<string, string> = {
      not_connected: '连接已断开，请在宿主重新连接后重试。', permission_denied: '权限不足。',
      too_large: '超过预览或编辑大小限制，请下载文件。', unsupported: '不支持此文件类型或操作，请下载查看。',
      expired: '预览或文件选择已过期，请重新打开。', directory_not_empty: '只能删除空目录。',
      partial_rename: '重命名未完全完成，请检查原路径与目标路径。', invalid_cursor: '目录分页已过期，请刷新。',
      conflict: '远端文件已修改，请重新加载或明确覆盖。',
    };
    return e instanceof RpcError ? codes[e.code] || `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e);
  }
  async function run(action: () => Promise<void>) {
    if (busy.value) return;
    const g = generation;
    busy.value = true; error.value = ''; status.value = '';
    try { await action(); } catch (e) { if (g === generation) error.value = message(e); }
    finally { if (g === generation) busy.value = false; }
  }
  async function discard() {
    return !dirty.value || await ask({ title: '放弃未保存修改？', danger: true, confirm: '放弃修改' }) !== null;
  }
  function release() {
    const previous = preview.value;
    if (previous?.url) URL.revokeObjectURL(previous.url);
    if (previous && api) void api('releasePreview', { token: previous.token }).catch(() => {});
    preview.value = undefined; content.value = ''; original.value = '';
  }
  async function load(target: string, more = false) {
    const g = generation;
    const response = await api('list', { uri: target, limit: 200, ...(more ? { cursor: cursor.value } : {}) });
    if (g !== generation) return;
    entries.value = more ? [...entries.value, ...response.entries] : response.entries;
    cursor.value = response.nextCursor || undefined;
    path.value = target; inputPath.value = target;
    tree.value[target] = entries.value.filter(e => e.kind === 'directory');
    expanded.value.add(target);
  }
  async function navigate(target: string) {
    await run(async () => {
      if (!await discard()) return;
      await load(target);
      release(); selected.value = undefined; filter.value = '';
    });
  }
  async function refresh() { await run(async () => { capabilities.value = await api('capabilities'); await load(path.value); }); }
  async function more() { await run(() => load(path.value, true)); }
  async function toggleTree(target: string) {
    if (expanded.value.has(target)) { expanded.value.delete(target); return; }
    await run(async () => {
      const g = generation;
      const response = await api('list', { uri: target, limit: 200 });
      if (g !== generation) return;
      tree.value[target] = response.entries.filter((e: Entry) => e.kind === 'directory');
      expanded.value.add(target);
    });
  }
  async function open(entry: Entry) {
    if (entry.kind === 'directory') return navigate(entry.uri);
    if (!capabilities.value.read || entry.kind !== 'file') return;
    await run(async () => {
      if (!await discard()) return;
      release(); selected.value = entry;
      const g = generation;
      const caller = api;
      const meta = await caller('preview', { uri: entry.uri });
      try {
        const bytes = new Uint8Array(meta.size);
        let offset = 0;
        while (offset < meta.size) {
          const chunk = await caller('previewChunk', { token: meta.token, offset });
          if (g !== generation) return;
          const decoded = decode(chunk.dataBase64);
          if (!decoded.length || chunk.nextOffset !== offset + decoded.length || chunk.nextOffset > bytes.length) throw new Error('预览数据不完整');
          bytes.set(decoded, offset); offset = chunk.nextOffset;
        }
        if (g !== generation) return;
        if (sha256(bytes) !== meta.digest) throw new Error('预览内容校验失败');
        if (meta.kind === 'text') {
          content.value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
          original.value = content.value;
          preview.value = { token: meta.token, entry, kind: 'text' };
        } else {
          if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(meta.mime)) throw new Error('不支持此图片格式');
          preview.value = { token: meta.token, entry, kind: 'image', url: URL.createObjectURL(new Blob([bytes], { type: meta.mime })) };
        }
      } finally {
        if (preview.value?.token !== meta.token) void caller('releasePreview', { token: meta.token }).catch(() => {});
      }
    });
  }
  async function closePreview() { if (!busy.value && await discard()) release(); }
  async function save() {
    if (!preview.value || !capabilities.value.write || !dirty.value) return;
    await run(async () => {
      const bytes = new TextEncoder().encode(content.value);
      if (bytes.length > 2 * 1024 * 1024) throw new Error('文本编辑上限为 2 MiB');
      const token = preview.value!.token;
      for (let offset = 0; offset < bytes.length || offset === 0; offset += CHUNK) {
        await api('stageText', { token, offset, dataBase64: encode(bytes.subarray(offset, offset + CHUNK)) });
      }
      const params = { token, size: bytes.length, digest: sha256(bytes) };
      try { await api('saveText', params); }
      catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'conflict') throw e;
        if (await ask({ title: '远端文件已修改', message: '覆盖将替换远端的新内容。取消后可关闭预览并重新打开文件。', danger: true, confirm: '覆盖远端内容' }) === null) return;
        await api('saveText', { ...params, force: true });
      }
      original.value = content.value;
      status.value = '已保存';
      await load(path.value);
    });
  }
  async function mkdir() {
    await run(async () => {
      const name = await ask({ title: '新建目录', value: '', confirm: '创建' });
      if (name === null) return;
      await api('createDirectory', { uri: childUri(path.value, name) });
      await load(path.value);
    });
  }
  async function rename() {
    const entry = selected.value; if (!entry) return;
    await run(async () => {
      if (!await discard()) return;
      const name = await ask({ title: '重命名', value: entry.name, message: capabilities.value.nativeRename ? undefined : '此服务通过复制后删除完成重命名，操作不是原子的。', confirm: '重命名' });
      if (name === null || name === entry.name) return;
      const params = { sourceUri: entry.uri, targetUri: childUri(path.value, name), overwrite: false };
      try { await api('rename', params); }
      catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'already_exists' || entry.kind !== 'file') throw e;
        if (await ask({ title: '目标已存在，是否覆盖？', danger: true, confirm: '覆盖' }) === null) return;
        await api('rename', { ...params, overwrite: true });
      }
      release(); selected.value = undefined; tree.value = {}; await load(path.value);
    });
  }
  async function remove() {
    const entry = selected.value; if (!entry) return;
    await run(async () => {
      if (!await discard()) return;
      if (await ask({ title: `删除“${entry.name}”？`, message: entry.kind === 'directory' ? '只能删除空目录，删除后无法撤销。' : '删除后无法撤销。', danger: true, confirm: '删除' }) === null) return;
      await api('delete', { uri: entry.uri, recursive: false });
      release(); selected.value = undefined; tree.value = {}; await load(path.value);
    });
  }
  async function transfer(upload: boolean) {
    const entry = selected.value;
    if (!upload && (!entry || entry.kind !== 'file')) return;
    await run(async () => {
      const selection = await api('chooseLocal', { upload, name: entry?.name || 'download' });
      if (selection.cancelled) return;
      const uri = upload ? childUri(path.value, selection.name) : entry!.uri;
      const params = { token: selection.token, uri, overwrite: !upload };
      try { await api('startTransfer', params); }
      catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'already_exists') throw e;
        if (await ask({ title: '远端文件已存在，是否覆盖？', danger: true, confirm: '覆盖' }) === null) return;
        await api('startTransfer', { ...params, overwrite: true });
      }
      await poll();
      await load(path.value);
    });
  }
  async function poll() {
    const g = generation;
    if (!api || disposed) return;
    try {
      const response = await api('transfer/list');
      if (g !== generation || disposed) return;
      const completed = response.transfers.some((t: Transfer) => terminal(t) && transfers.value.some(old => old.transferId === t.transferId && !terminal(old)));
      transfers.value = response.transfers;
      if (completed && !busy.value) await load(path.value);
    } catch (e) { if (g === generation) error.value = message(e); }
  }
  async function cancel(t: Transfer) { await run(async () => { await api('transfer/cancel', { transferId: t.transferId }); await poll(); }); }
  async function initialize(context: Context) {
    release(); generation++; clearTimeout(timer);
    entries.value = []; tree.value = {}; expanded.value = new Set(); transfers.value = []; selected.value = undefined;
    capabilities.value = {}; busy.value = false; filter.value = '';
    try { api = client(context); } catch (e) { error.value = message(e); return; }
    root.value = `${context.connectionType}:/`; path.value = root.value; inputPath.value = path.value;
    await refresh();
    const g = generation;
    const tick = async () => {
      if (disposed || g !== generation) return;
      await poll();
      if (!disposed && g === generation) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
  }
  onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); release(); });
  return { path, inputPath, root, entries, cursor, selected, capabilities, busy, error, status, filter, order, tree, expanded,
    transfers, preview, content, dirty, rows, initialize, navigate, refresh, more, toggleTree, open, closePreview, save, mkdir, rename, remove, transfer, cancel,
    up: () => navigate(parentUri(path.value)), terminal };
}
