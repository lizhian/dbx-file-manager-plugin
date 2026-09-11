export interface Context { connectionId?: string; providerId?: string; connectionType?: string }
export interface Bridge {
  ready: Promise<unknown>;
  context: Context;
  invoke(method: string, params: unknown, options?: { timeoutMs: number }): Promise<unknown>;
  onContext(listener: (context: Context) => void): () => void;
}
declare global { interface Window { dbxPlugin?: Bridge } }
export class RpcError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export function client(context: Context) {
  if (!context.connectionId || !context.providerId) throw new Error('请从宿主连接列表打开文件连接');
  const binding = { connectionId: context.connectionId, providerId: `${context.providerId}.files` };
  return async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    if (!window.dbxPlugin) throw new Error('请在 DBX 中打开此页面');
    const response = await window.dbxPlugin.invoke(`workbench/${method}`, { ...params, ...binding }, { timeoutMs: 300000 }) as any;
    if (!response?.ok) throw new RpcError(response?.error?.details?.code || 'backend', response?.error?.message || '操作失败');
    return response.value as T;
  };
}
export type Client = ReturnType<typeof client>;
export type Capability = 'list' | 'read' | 'stat' | 'write' | 'mkdir' | 'delete' | 'copy' | 'rename' | 'upload' | 'download' | 'edit';
export type Capabilities = Partial<Record<Capability, boolean>> & {
  rootUri?: string;
  readOnly?: boolean;
  nativeRename?: boolean;
  verification?: 'verified' | 'configuration_only';
};
export const ROOT_URI = 'opendal:/';
export function displayPath(uri: string, root = ROOT_URI): string {
  if (!uri.startsWith(root)) throw new Error('路径不属于当前连接');
  return '/' + decodeURIComponent(uri.slice(root.length));
}
export function resolvePath(input: string, root = ROOT_URI): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) throw new Error('请输入相对于连接根目录的路径，不要输入服务 URL');
  const relative = input.replace(/^\//, '').replace(/\/$/, '');
  if (!relative) return root;
  return relative.split('/').reduce((parent, name) => childUri(parent, name), root);
}
export interface Entry { name: string; uri: string; kind: string; size?: number; modifiedAt?: string }
export interface Transfer { transferId: string; direction: string; state: string; bytesTransferred: number; totalBytes?: number; uri: string; error?: unknown }
export function parentUri(uri: string): string {
  const colon = uri.indexOf(':');
  const parts = uri.slice(colon + 1).split('/').filter(Boolean);
  parts.pop();
  return `${uri.slice(0, colon)}:/${parts.join('/')}${parts.length ? '/' : ''}`;
}
export function childUri(parent: string, name: string): string {
  if (!name.trim() || name === '.' || name === '..' || /[\/\\\x00-\x1f]/.test(name)) throw new Error('名称不能为空，不能包含路径分隔符或控制字符');
  return `${parent.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
}
export function sortEntries(entries: Entry[], order: 'name' | 'size' = 'name'): Entry[] {
  return [...entries].sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || (order === 'size' ? (b.size || 0) - (a.size || 0) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })));
}
export function encode(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function decode(encoded: string): Uint8Array { return Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); }
export function formatSize(size?: number): string {
  if (size === undefined) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 ** 2).toFixed(1)} MiB`;
}
