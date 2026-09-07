import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCapabilities, checkFileEntry, checkSnapshot } from '../scripts/live-contract.mjs';

test('capability response requires canonical array, not legacy flat booleans', () => {
  checkCapabilities({ capabilities: ['read', 'list'], read: true }, ['read']);
  assert.throws(() => checkCapabilities({ read: true, list: true }, ['read']));
  assert.throws(() => checkCapabilities({ capabilities: ['read', 'read'] }, ['read']));
  assert.throws(() => checkCapabilities({ capabilities: ['read', 'dynamic'] }, ['read']));
  assert.throws(() => checkCapabilities({ capabilities: ['read', 'write'] }, ['read'], ['write']));
});
test('stat requires plain Entry and rejects the old wrapper', () => {
  const entry = { name: 'source.txt', uri: 'ftp:/source.txt', kind: 'file', size: 4 };
  checkFileEntry(entry, entry.uri, 4);
  assert.throws(() => checkFileEntry({ entry }, entry.uri, 4));
});
test('transfer start requires a full scoped snapshot, not just transferId', () => {
  const scope = { providerId: 'ftp.files', connectionId: 'test' };
  const snapshot = { ...scope, transferId: 'task', direction: 'upload', uri: 'ftp:/source.txt',
    state: 'queued', bytesTransferred: 0, totalBytes: null, error: null };
  checkSnapshot(snapshot, scope, 'upload', snapshot.uri);
  assert.throws(() => checkSnapshot({ transferId: 'task' }, scope, 'upload', snapshot.uri));
  assert.throws(() => checkSnapshot({ ...snapshot, connectionId: 'other' }, scope, 'upload', snapshot.uri));
  assert.throws(() => checkSnapshot({ ...snapshot, state: 'done' }, scope, 'upload', snapshot.uri));
});
