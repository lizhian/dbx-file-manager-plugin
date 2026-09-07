import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertWindowsX64Header } from './pe-format.mjs';

assert.ok(process.platform === 'linux' && process.env.DBX_PLATFORM_CONTAINER === '1', 'Run in the isolated cross-compilation container');
const runId = randomUUID();
const output = join('/artifacts', runId);
await mkdir(output);
const work = await mkdtemp('/tmp/dbx-windows-cross-');
const target = 'x86_64-pc-windows-gnu';
const report = { runId, date: new Date().toISOString(), buildHost: `${process.platform}-${process.arch}`, target,
  rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
  steps: [], compiled: false, runtimeVerified: false, scope: 'Windows GNU cross-compilation only. No Windows execution.' };
async function step(name, command, args, { quiet = false } = {}) {
  const record = { name, command: [command, ...args], log: `${report.steps.length + 1}-${name}.log` };
  report.steps.push(record);
  const log = createWriteStream(join(output, record.log), { flags: 'wx' });
  const child = spawn(command, args, { cwd: work, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.pipe(log, { end: false });
    if (!quiet) stream.pipe(process.stdout, { end: false });
  }
  let spawnError;
  child.on('error', error => { spawnError = error; });
  Object.assign(record, await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))));
  await new Promise(resolve => log.end(resolve));
  assert.ok(!spawnError && record.code === 0, `Windows cross step ${name} failed; see ${record.log}`);
}
try {
  await cp('/source', work, { recursive: true, force: false, errorOnExist: true });
  report.sourceSha256 = {};
  const sources = ['backend/Cargo.toml', 'backend/Cargo.lock', 'manifest.json',
    ...(await readdir(join(work, 'backend/src'), { recursive: true })).filter(p => p.endsWith('.rs')).map(p => `backend/src/${p}`)];
  for (const file of sources.sort()) report.sourceSha256[file] = createHash('sha256').update(await readFile(join(work, file))).digest('hex');
  const args = ['--locked', '--manifest-path', 'backend/Cargo.toml', '--target', target];
  await step('check', 'cargo', ['check', ...args, '--all-targets']);
  await step('clippy', 'cargo', ['clippy', ...args, '--offline', '--all-targets', '--', '-D', 'warnings']);
  await step('release', 'cargo', ['build', ...args, '--offline', '--release']);
  await step('test-link', 'cargo', ['test', ...args, '--offline', '--no-run']);
  const binary = join(process.env.CARGO_TARGET_DIR, target, 'release/dbx-plugin-dbx-file-manager-plugin.exe');
  await step('pe-format', 'file', [binary]);
  await step('pe-imports', 'x86_64-w64-mingw32-objdump', ['-p', binary], { quiet: true });
  const bytes = await readFile(binary);
  report.executableFormat = assertWindowsX64Header(bytes);
  report.binarySha256 = createHash('sha256').update(bytes).digest('hex');
  report.binarySize = bytes.length;
  await cp(binary, join(output, 'dbx-plugin-dbx-file-manager-plugin.exe'), { force: false, errorOnExist: true });
  for (const [file, hash] of Object.entries(report.sourceSha256)) {
    assert.equal(createHash('sha256').update(await readFile(join(work, file))).digest('hex'), hash, `Source changed: ${file}`);
  }
  report.sourceUnchanged = true;
  report.compiled = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'cross-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await rm(work, { recursive: true, force: true });
  console.log(`WINDOWS CROSS RESULT ${JSON.stringify({ runId, compiled: report.compiled, runtimeVerified: false, output })}`);
}
