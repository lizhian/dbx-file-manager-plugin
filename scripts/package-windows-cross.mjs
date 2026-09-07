import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { assertWindowsX64Header } from './pe-format.mjs';
import { readJson, validateManifest, root } from './validate-manifest.mjs';

const [run, output, packager] = process.argv.slice(2);
assert.ok([run, output, packager].every(p => p && isAbsolute(p)),
  'Usage: node scripts/package-windows-cross.mjs <cross-run-dir> <new-output-dir> <dbx-plugin-packager>');
const report = JSON.parse(await readFile(join(run, 'cross-report.json'), 'utf8'));
assert.ok(report.compiled && report.sourceUnchanged && report.target === 'x86_64-pc-windows-gnu');
assert.equal(report.runtimeVerified, false);
assert.deepEqual(report.steps.map(s => s.name), ['check', 'clippy', 'release', 'test-link', 'pe-format', 'pe-imports']);
assert.ok(report.steps.every(s => s.code === 0));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [path, expected] of Object.entries(report.sourceSha256)) {
  assert.equal(hash(await readFile(join(root, path))), expected, `Source changed since compilation: ${path}`);
}
const executable = join(run, 'dbx-plugin-dbx-file-manager-plugin.exe');
const bytes = await readFile(executable);
assert.equal(hash(bytes), report.binarySha256);
assert.equal(bytes.length, report.binarySize);
assertWindowsX64Header(bytes);
const manifest = validateManifest(readJson('manifest.json'));
manifest.entrypoints.backend.executable = 'bin/windows-x64/dbx-plugin-dbx-file-manager-plugin.exe';
assert.deepEqual(manifest.entrypoints.backend.protocol_versions, [1]);
delete manifest.entrypoints.backend.protocol_versions;
await mkdir(output);
const stage = await mkdtemp(join(tmpdir(), 'dbx-windows-package-'));
try {
  await mkdir(join(stage, 'bin/windows-x64'), { recursive: true });
  await mkdir(join(stage, 'assets'));
  await cp(executable, join(stage, manifest.entrypoints.backend.executable));
  for (const path of ['assets/plugin.svg', 'LICENSE', 'NOTICE']) await cp(join(root, path), join(stage, path));
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const name = `${manifest.id}-${manifest.version}-windows-x64`;
  const archive = join(output, `${name}.dbxp`);
  execFileSync(packager, [stage, archive, '--artifact-metadata', join(output, `${name}.artifact.json`), '--target', 'windows-x64'], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(root, 'scripts/verify-package.mjs'), archive], { stdio: 'inherit' });
  await writeFile(join(output, 'cross-provenance.json'), `${JSON.stringify({ crossRunId: report.runId,
    target: report.target, binarySha256: report.binarySha256, runtimeVerified: false,
    packagerSha256: hash(await readFile(packager)),
    packaging: 'Explicit cross-target staging using the DBX low-level packager, not a native Windows CLI run' }, null, 2)}\n`);
} finally { await rm(stage, { recursive: true, force: true }); }
