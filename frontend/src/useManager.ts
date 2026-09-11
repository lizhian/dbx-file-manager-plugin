import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { sha256 } from 'js-sha256';
import { childUri, client, decode, encode, parentUri, RpcError, sortEntries, type Capabilities, type Capability, ROOT_URI, resolvePath, displayPath, type Client, type Context, type Entry, type Transfer } from './bridge';

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
  const capabilities = ref<Capabilities>({});
  const busy = ref(false);
  const error = ref('');
  const status = ref('');
  const tree = ref<Record<string, Entry[]>>({});
  const expanded = ref(new Set<string>());
  const treeCursors = ref<Record<string, string | undefined>>({});
  const transfers = ref<Transfer[]>([]);
  const localTokens = ref<Record<string, string>>({});
  const preview = shallowRef<{ token: string; entry: Entry; kind: string; url?: string; truncated?: boolean; byteLimited?: boolean; editable?: boolean }>();
  const content = ref('');
  const original = ref('');
  const dirty = computed(() => content.value !== original.value);
  const rows = computed(() => sortEntries(entries.value));
  const tableRows = computed(() => {
    const result: { entry: Entry; depth: number; more?: boolean }[] = [];
    const visit = (items: Entry[], depth: number) => {
      for (const entry of sortEntries(items)) {
        result.push({ entry, depth });
        if (entry.kind === 'directory' && expanded.value.has(entry.uri)) {
          visit(tree.value[entry.uri] || [], depth + 1);
          if (treeCursors.value[entry.uri]) result.push({ entry, depth: depth + 1, more: true });
        }
      }
    };
    visit(entries.value, 0);
    return result;
  });
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
  async function unsupported(operation: string) {
    await ask({ title: '操作不支持', message: `当前连接：不支持${operation}，或无法满足该操作所需的文件管理保证。`, confirm: '知道了' });
  }
  function can(capability: Capability) {
    const mutation = ['write', 'mkdir', 'delete', 'copy', 'rename', 'upload', 'edit'].includes(capability);
    return capabilities.value[capability] === true && !(mutation && capabilities.value.readOnly);
  }
  const canEdit = computed(() => can('edit') && can('write') && preview.value?.kind === 'text' && !preview.value.truncated && preview.value.editable !== false);
  async function requireCapability(capability: Capability, operation: string) {
    if (can(capability)) return true;
    await unsupported(operation); return false;
  }
  async function run(action: () => Promise<void>, operation = '此操作') {
    if (busy.value) return;
    const g = generation;
    busy.value = true; error.value = ''; status.value = '';
    try { await action(); } catch (e) { if (g === generation) {
      error.value = message(e);
      if (e instanceof RpcError && e.code === 'unsupported') await unsupported(operation);
    } }
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
    if (!can('list')) {
      entries.value = []; cursor.value = undefined;
      path.value = target; inputPath.value = displayPath(target, root.value);
      return;
    }
    const g = generation;
    const response = await api('list', { uri: target, limit: 200, ...(more ? { cursor: cursor.value } : {}) });
    if (g !== generation) return;
    entries.value = more ? [...entries.value, ...response.entries] : response.entries;
    cursor.value = response.nextCursor || undefined;
    path.value = target; inputPath.value = displayPath(target, root.value);
    tree.value[target] = entries.value;
    if (!more) for (const uri of [...expanded.value]) {
      if (uri === target) continue;
      try {
        const branch = await api('list', { uri, limit: 200 });
        if (g !== generation) return;
        tree.value[uri] = branch.entries; treeCursors.value[uri] = branch.nextCursor;
      } catch { expanded.value.delete(uri); delete tree.value[uri]; }
    }
  }
  async function navigate(target: string) {
    await run(async () => {
      if (!await discard()) return;
      await load(target);
      expanded.value.clear(); tree.value = {}; treeCursors.value = {};
      release(); selected.value = undefined;
    });
  }
  async function refresh() { await run(async () => {
    const snapshot = await api<Capabilities>('capabilities');
    if (snapshot.rootUri && snapshot.rootUri !== ROOT_URI) throw new Error('连接返回了不支持的根路径');
    capabilities.value = snapshot; await load(path.value);
  }, '刷新目录'); }
  async function accessPath(operation: 'directory' | 'preview' | 'download') {
    let target: string;
    try {
      target = resolvePath(inputPath.value, root.value);
    } catch (e) { error.value = message(e); return; }
    if (operation === 'directory') return navigate(target === root.value ? target : `${target}/`);
    if (target === root.value) { error.value = '请输入文件路径'; return; }
    const entry = { name: decodeURIComponent(target.slice(target.lastIndexOf('/') + 1)), uri: target, kind: 'file' };
    if (operation === 'preview') await open(entry);
    else { selected.value = entry; await transfer(false); }
    if (capabilities.value.list === false && selected.value?.uri === entry.uri) entries.value = [entry];
  }
  async function more() { await run(() => load(path.value, true)); }
  async function listDirectories(uri: string, cursor?: string): Promise<{ entries: Entry[]; nextCursor?: string }> {
    if (!can('list')) return { entries: [] };
    const result = await api('list', { uri, limit: 200, ...(cursor ? { cursor } : {}) });
    return { entries: result.entries.filter((entry: Entry) => entry.kind === 'directory'), nextCursor: result.nextCursor };
  }
  async function toggleTree(target: string, more = false) {
    if (busy.value) return;
    if (!more && expanded.value.has(target)) { expanded.value.delete(target); return; }
    await run(async () => {
      const g = generation;
      const response = await api('list', { uri: target, limit: 200, ...(more ? { cursor: treeCursors.value[target] } : {}) });
      if (g !== generation) return;
      tree.value[target] = more ? [...(tree.value[target] || []), ...response.entries] : response.entries;
      treeCursors.value[target] = response.nextCursor;
      expanded.value.add(target);
    });
  }
  async function open(entry: Entry) {
    if (entry.kind === 'directory') return navigate(entry.uri);
    if (entry.kind !== 'file') return;
    await run(async () => {
      if (!await requireCapability('read', '文件预览')) return;
      if (!await discard()) return;
      const previous = preview.value;
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
          preview.value = { token: meta.token, entry, kind: 'text', truncated: meta.truncated, byteLimited: meta.byteLimited, editable: meta.editable };
        } else {
          if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(meta.mime)) throw new Error('不支持此图片格式');
          content.value = ''; original.value = '';
          preview.value = { token: meta.token, entry, kind: 'image', url: URL.createObjectURL(new Blob([bytes], { type: meta.mime })) };
        }
        selected.value = entry;
        if (previous?.url) URL.revokeObjectURL(previous.url);
        if (previous && previous.token !== meta.token) void caller('releasePreview', { token: previous.token }).catch(() => {});
      } finally {
        if (preview.value?.token !== meta.token) void caller('releasePreview', { token: meta.token }).catch(() => {});
      }
    }, '文件预览');
  }
  async function closePreview() { if (!busy.value && await discard()) release(); }
  async function save() {
    if (!canEdit.value || !dirty.value) return;
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
      if (!await requireCapability('mkdir', '新建目录')) return;
      const name = await ask({ title: '新建目录', value: '', confirm: '创建' });
      if (name === null) return;
      await api('createDirectory', { uri: childUri(path.value, name) });
      await load(path.value);
    });
  }
  async function mkdirAt(directory: string, name: string) {
    await run(async () => { if (!name) return; if (!await requireCapability('mkdir', '新建目录')) return; await api('createDirectory', { uri: childUri(directory, name) }); await load(path.value); });
  }
  async function rename(requestedName?: string) {
    if (selected.value) await copyTo(parentUri(selected.value.uri), true, requestedName);
  }
  async function remove() {
    const entry = selected.value; if (!entry) return;
    await run(async () => {
      if (!await requireCapability('delete', '删除')) return;
      if (!await discard()) return;
      if (await ask({ title: `删除“${entry.name}”？`, message: entry.kind === 'directory' ? '只能删除空目录，删除后无法撤销。' : '删除后无法撤销。', danger: true, confirm: '删除' }) === null) return;
      await api('delete', { uri: entry.uri, recursive: false });
      release(); selected.value = undefined; tree.value = {}; await load(path.value);
    });
  }
  async function copy() {
    if (selected.value) await copyTo(parentUri(selected.value.uri));
  }
  async function copyTo(targetDirectory: string, move = false, requestedName?: string) {
    const entry = selected.value;
    if (!entry || (!move && entry.kind !== 'file')) return;
    await run(async () => {
      if (!await requireCapability(move ? 'rename' : 'copy', move ? '移动或重命名' : '复制')) return;
      if (move && !await discard()) return;
      const name = requestedName ?? await ask({ title: move ? '移动或重命名' : '复制文件', value: entry.name, confirm: move ? '确定' : '复制' });
      if (!name) return;
      const targetUri = childUri(targetDirectory, name);
      if (targetUri === entry.uri.replace(/\/$/, '')) return;
      const params = { sourceUri: entry.uri, targetUri, overwrite: false };
      const method = move ? 'rename' : 'copy';
      try { await api(method, params); }
      catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'already_exists' || entry.kind !== 'file') throw e;
        if (await ask({ title: '目标已存在，是否覆盖？', danger: true, confirm: '覆盖' }) === null) return;
        await api(method, { ...params, overwrite: true });
      }
      if (move) { release(); selected.value = undefined; tree.value = {}; }
      await load(path.value);
    });
  }
  async function transfer(upload: boolean, targetDirectory = path.value) {
    const entry = selected.value;
    if (!upload && (!entry || entry.kind !== 'file')) return;
    await run(async () => {
      if (!await requireCapability(upload ? 'upload' : 'download', upload ? '上传' : '下载')) return;
      const selection = await api('chooseLocal', { upload, name: entry?.name || 'download' });
      if (selection.cancelled) return;
      const uri = upload ? childUri(targetDirectory, selection.name) : entry!.uri;
      const params = { token: selection.token, uri, overwrite: !upload };
      let task: Transfer;
      try { task = await api('startTransfer', params); }
      catch (e) {
        if (!(e instanceof RpcError) || e.code !== 'already_exists') throw e;
        if (await ask({ title: '远端文件已存在，是否覆盖？', danger: true, confirm: '覆盖' }) === null) return;
        task = await api('startTransfer', { ...params, overwrite: true });
      }
      if (!upload) localTokens.value[task.transferId] = selection.token;
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
  async function openLocal(t: Transfer, reveal: boolean) {
    if (t.state !== 'completed' || !localTokens.value[t.transferId]) return;
    await run(async () => { await api('openLocal', { token: localTokens.value[t.transferId], reveal }); });
  }
  async function initialize(context: Context) {
    release(); generation++; clearTimeout(timer);
    entries.value = []; tree.value = {}; expanded.value = new Set(); treeCursors.value = {}; localTokens.value = {}; transfers.value = []; selected.value = undefined;
    capabilities.value = {}; busy.value = false;
    try { api = client(context); } catch (e) { error.value = message(e); return; }
    root.value = ROOT_URI; path.value = root.value; inputPath.value = '/';
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
  return { path, inputPath, root, entries, cursor, selected, capabilities, busy, error, status, can, canEdit, tree, expanded, accessPath,
    transfers, localTokens, openLocal, preview, content, dirty, rows, tableRows, initialize, navigate, refresh, more, toggleTree, open, closePreview, save, mkdir, mkdirAt, rename, remove, copy, copyTo, transfer, cancel,
    up: () => navigate(parentUri(path.value)), terminal, listDirectories };
}
