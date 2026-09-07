import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertWindowsX64Header } from '../scripts/pe-format.mjs';

function header() {
  const bytes = Buffer.alloc(256);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(128, 0x3c);
  bytes.writeUInt32LE(0x4550, 128);
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(0x2, 150);
  bytes.writeUInt16LE(0x20b, 152);
  return bytes;
}
test('Windows header validation distinguishes PE32+ AMD64 from mislabeled inputs', () => {
  assert.deepEqual(assertWindowsX64Header(header()), { format: 'PE32+', machine: 'AMD64' });
  for (const change of [b => b.writeUInt16LE(0x457f, 0), b => b.writeUInt32LE(9999, 0x3c),
    b => b.writeUInt32LE(0, 128), b => b.writeUInt16LE(0xaa64, 132), b => b.writeUInt16LE(0x10b, 152),
    b => b.writeUInt16LE(0x2002, 150)]) {
    const bytes = header(); change(bytes); assert.throws(() => assertWindowsX64Header(bytes));
  }
  assert.throws(() => assertWindowsX64Header(Buffer.alloc(8)));
});
test('Windows cross runner refuses accidental execution outside its container context', () => {
  const env = { ...process.env }; delete env.DBX_PLATFORM_CONTAINER;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/windows-cross-check.mjs', import.meta.url))],
    { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run in the isolated cross-compilation container/);
});
