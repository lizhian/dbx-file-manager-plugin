import { describe, expect, it, vi } from 'vitest';
import { childUri, client, decode, encode, parentUri, RpcError, sortEntries } from './bridge';
describe('Host API 1.0 bridge', () => {
  it('binds requests to the current connection, not caller supplied identifiers', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: 42 });
    window.dbxPlugin = { ready: Promise.resolve(), context: {}, invoke, onContext: () => () => {} };
    const api = client({ connectionId: 'a', providerId: 'p', connectionType: 's3' });
    expect(await api('list', { connectionId: 'b', providerId: 'wrong' })).toBe(42);
    expect(invoke.mock.calls[0][1]).toEqual({ connectionId: 'a', providerId: 'p.files' });
  });
  it('preserves structured errors through string-only host errors', async () => {
    window.dbxPlugin!.invoke = vi.fn().mockResolvedValue({ ok: false, error: { message: 'changed', details: { code: 'conflict' } } });
    await expect(client({ connectionId: 'a', providerId: 'p', connectionType: 's3' })('saveText')).rejects.toMatchObject({ code: 'conflict' });
    expect(new RpcError('x', 'error')).toBeInstanceOf(Error);
  });
  it('requires a saved connection context', () => { expect(() => client({})).toThrow(); });
});
describe('file paths and content', () => {
  it('keeps a root relative URI and encodes special filenames', () => {
    expect(parentUri('s3:/a/b/')).toBe('s3:/a/');
    expect(parentUri('ftp:/')).toBe('ftp:/');
    expect(childUri('s3:/', '中文 #1.txt')).toBe('s3:/%E4%B8%AD%E6%96%87%20%231.txt');
    for (const name of ['', '.', '..', 'a/b', 'a\\b', '\0']) expect(() => childUri('s3:/', name)).toThrow();
  });
  it('encodes full chunks without exceeding JS argument limits', () => {
    const bytes = new Uint8Array(512 * 1024).fill(231);
    expect(decode(encode(bytes))).toEqual(bytes);
  });
  it('always sorts directories first without mutating source rows', () => {
    const rows = [{ name: 'b', uri: 's3:/b', kind: 'file' }, { name: 'a', uri: 's3:/a', kind: 'directory' }];
    expect(sortEntries(rows)[0].name).toBe('a'); expect(rows[0].name).toBe('b');
  });
});
