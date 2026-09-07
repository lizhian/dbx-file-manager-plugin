import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, validateManifest } from './validate-manifest.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  assert.ok([3, 4].includes(process.argv.length), 'Usage: node scripts/verify-package.mjs candidate.dbxp [source-directory]');
  const sourceDirectory = resolve(process.argv[3] ?? root);
  const archive = resolve(process.argv[2]);
  assert.ok(archive.endsWith('.dbxp'), 'Expected .dbxp package');
  const metadata = JSON.parse(readFileSync(archive.replace(/\.dbxp$/, '.artifact.json'), 'utf8'));
  assert.ok(/^(darwin|linux|windows)-(arm64|x64)$/.test(metadata.target));
  assert.ok(!('signingKeyId' in metadata), 'Expected unsigned local candidate');
  const bytes = readFileSync(archive);
  assert.equal(metadata.size, bytes.length);
  assert.equal(metadata.sha256, sha256(bytes));
  const names = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(new Set(names).size, names.length, 'Duplicate ZIP entry');
  const source = validateManifest(JSON.parse(readFileSync(resolve(sourceDirectory, 'manifest.json'), 'utf8')));
  const binary = `bin/${metadata.target}/${source.entrypoints.backend.executable.split('/').at(-1)}${metadata.target.startsWith('windows-') ? '.exe' : ''}`;
  assert.deepEqual(names.sort(), ['LICENSE', 'NOTICE', 'assets/plugin.svg', binary, 'checksums.json', 'manifest.json'].sort());
  const member = (name) => execFileSync('unzip', ['-p', archive, name], { maxBuffer: 512 * 1024 * 1024 });
  const manifest = JSON.parse(member('manifest.json'));
  const expected = structuredClone(source);
  expected.entrypoints.backend.executable = binary;
  // DBX CLI removes exactly the default [1]; the host deserializer restores [1].
  delete expected.entrypoints.backend.protocol_versions;
  assert.deepEqual(manifest, expected, 'Packaged manifest differs beyond documented CLI normalization');
  const checksums = JSON.parse(member('checksums.json'));
  assert.equal(checksums.algorithm, 'sha256');
  assert.deepEqual(Object.keys(checksums.files).sort(), names.filter((name) => name !== 'checksums.json').sort());
  for (const [name, hash] of Object.entries(checksums.files)) assert.equal(sha256(member(name)), hash, name);
  assert.deepEqual(member('LICENSE'), readFileSync(resolve(sourceDirectory, 'LICENSE')));
  assert.deepEqual(member('NOTICE'), readFileSync(resolve(sourceDirectory, 'NOTICE')));
  console.log(`Verified unsigned ${metadata.target} package: exact file allowlist, manifest parity, license/notice and all SHA-256 checksums.`);
  console.log(`SHA-256 ${metadata.sha256}; ${metadata.size} bytes. Host install/live acceptance is separate.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
