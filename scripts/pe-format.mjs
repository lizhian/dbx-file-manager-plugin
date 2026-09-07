import assert from 'node:assert/strict';

export function assertWindowsX64Header(bytes) {
  assert.ok(bytes.length >= 64, 'Truncated DOS header');
  assert.equal(bytes.readUInt16LE(0), 0x5a4d, 'Missing DOS signature');
  const pe = bytes.readUInt32LE(0x3c);
  assert.ok(pe >= 64 && pe + 26 <= bytes.length, 'Invalid PE header offset');
  assert.equal(bytes.readUInt32LE(pe), 0x4550, 'Missing PE signature');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Not an AMD64 executable');
  assert.equal(bytes.readUInt16LE(pe + 24), 0x20b, 'Not PE32+');
  const flags = bytes.readUInt16LE(pe + 22);
  assert.ok((flags & 0x2) !== 0 && (flags & 0x2000) === 0, 'Expected executable image, not DLL');
  return { format: 'PE32+', machine: 'AMD64' };
}
