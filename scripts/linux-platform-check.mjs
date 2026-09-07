import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

assert.ok(process.platform === 'linux' && process.env.DBX_PLATFORM_CONTAINER === '1', 'Run in the isolated Linux platform container');
const runId = randomUUID();
const output = join('/artifacts', runId);
await mkdir(output);
const work = await mkdtemp('/tmp/dbx-linux-platform-');
const report = { runId, date: new Date().toISOString(), platform: process.platform, arch: process.arch,
  scope: 'Native Linux sidecar, package and direct protocol fixtures. No Linux host GUI acceptance.',
  rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(), node: process.version,
  steps: [], passed: false };
const env = { ...process.env, DBX_FM_PROTOCOLS: 'ftp,sftp,s3,webdav,webhdfs,hdfs-native' };

async function step(name, binary, args) {
  const record = { name, command: [binary, ...args], log: `${report.steps.length + 1}-${name}.log` };
  report.steps.push(record);
  const log = createWriteStream(join(output, record.log), { flags: 'wx' });
  const started = performance.now();
  console.log(`PLATFORM STEP ${name}`);
  const child = spawn(binary, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  let error;
  child.once('error', cause => { error = cause; });
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise(resolve => log.end(resolve));
  Object.assign(record, result, { elapsedMs: Math.round(performance.now() - started) });
  assert.ok(!error && result.code === 0, `Platform step ${name} failed; see ${record.log}`);
}

try {
  // /source is a prefiltered, read-only snapshot, not the user's repository or runtime directory.
  await cp('/source', work, { recursive: true, force: false, errorOnExist: true });
  const paths = ['manifest.json', 'backend/Cargo.toml', 'backend/Cargo.lock',
    ...(await readdir(join(work, 'backend/src'), { recursive: true })).filter(p => p.endsWith('.rs')).map(p => `backend/src/${p}`)];
  report.sourceSha256 = {};
  for (const path of paths.sort()) report.sourceSha256[path] = createHash('sha256').update(await readFile(join(work, path))).digest('hex');
  await step('git-fixture', 'git', ['init', '-q', '-b', 'main']);
  await step('node-dependencies', 'npm', ['ci', '--prefix', 'tests', '--ignore-scripts', '--no-audit', '--no-fund']);
  await step('manifest', 'node', ['scripts/validate-manifest.mjs']);
  const tests = (await readdir(join(work, 'tests'))).filter(p => p.endsWith('.test.mjs')).sort().map(p => `tests/${p}`);
  await step('node-tests', 'node', ['--test', ...tests]);
  await step('rust-format', 'cargo', ['fmt', '--manifest-path', 'backend/Cargo.toml', '--', '--check']);
  await step('rust-tests', 'cargo', ['test', '--locked', '--manifest-path', 'backend/Cargo.toml']);
  await step('rust-clippy', 'cargo', ['clippy', '--locked', '--offline', '--manifest-path', 'backend/Cargo.toml', '--all-targets', '--', '-D', 'warnings']);
  await step('rust-live', 'cargo', ['test', '--locked', '--offline', '--manifest-path', 'backend/Cargo.toml', 'live_native_listing_regression', '--', '--ignored']);
  await step('package', 'node', ['scripts/package.mjs', '--output-dir', 'dist/platform']);
  const sourceManifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8'));
  const packageName = `${sourceManifest.id}-${sourceManifest.version}-linux-${process.arch}.dbxp`;
  const archive = join(work, 'dist/platform', packageName);
  await step('verify-package', 'node', ['scripts/verify-package.mjs', archive]);
  const extracted = join(work, 'dist/platform/extracted');
  await step('extract', 'unzip', ['-q', archive, '-d', extracted]);
  const manifest = JSON.parse(await readFile(join(extracted, 'manifest.json'), 'utf8'));
  env.DBX_FILE_MANAGER_BINARY = join(extracted, manifest.entrypoints.backend.executable);
  await step('elf-format', 'file', [env.DBX_FILE_MANAGER_BINARY]);
  await step('elf-libraries', 'ldd', [env.DBX_FILE_MANAGER_BINARY]);
  await step('six-protocol-live', 'node', ['scripts/live-contract.mjs']);
  await step('runtime', 'node', ['scripts/runtime-contract.mjs']);
  await step('six-protocol-resource', 'node', ['scripts/transfer-resource-contract.mjs']);
  await step('webdav-interruption', 'node', ['scripts/transfer-interruption-contract.mjs']);
  report.package = JSON.parse(await readFile(archive.replace(/\.dbxp$/, '.artifact.json'), 'utf8'));
  report.binarySha256 = createHash('sha256').update(await readFile(env.DBX_FILE_MANAGER_BINARY)).digest('hex');
  for (const [path, sha256] of Object.entries(report.sourceSha256)) {
    assert.equal(createHash('sha256').update(await readFile(join(work, path))).digest('hex'), sha256,
      `Platform checks changed source file ${path}`);
  }
  report.sourceUnchanged = true;
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  for (const [source, name] of [['dist/platform', 'package'], ['docs/evidence', 'evidence']]) {
    try { await cp(join(work, source), join(output, name), { recursive: true, force: false, errorOnExist: true }); }
    catch (error) { if (error.code !== 'ENOENT') { report.passed = false; report.exportFailure = error.message; process.exitCode = 1; } }
  }
  await writeFile(join(output, 'platform-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await rm(work, { recursive: true, force: true });
  console.log(`PLATFORM RESULT ${JSON.stringify({ runId, passed: report.passed, output })}`);
}
