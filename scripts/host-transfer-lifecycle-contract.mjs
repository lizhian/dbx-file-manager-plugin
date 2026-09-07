import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, basename, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { transferProxy } from './transfer-proxy.mjs';

assert.ok(['darwin', 'linux'].includes(process.platform), 'This process-stop fixture requires Unix');
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'force-stop': { type: 'boolean', default: false },
  direction: { type: 'string', default: 'all' },
  action: { type: 'string', default: 'all' },
} });
const [host, firstPackage, secondPackage] = positionals;
assert.ok(['all', 'upload', 'download'].includes(values.direction), 'Invalid direction');
assert.ok(['all', 'upgrade', 'rollback'].includes(values.action), 'Invalid action');
const stopMode = values['force-stop'] ? 'forced' : 'graceful';
assert.ok(positionals.length === 3 && [host, firstPackage, secondPackage].every(p => p && isAbsolute(p)),
  'Usage: node scripts/host-transfer-lifecycle-contract.mjs [--force-stop] [--direction=all|upload|download] [--action=all|upgrade|rollback] <host-repository> <0.1.0.dbxp> <0.1.1.dbxp>');
const id = 'io.github.lizhian.file-manager';
const suiteId = randomUUID();
const report = { suiteId, date: new Date().toISOString(), host: resolve(host), stopMode, cases: [], passed: false,
  hostHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: host, encoding: 'utf8' }).trim(),
  hostFixtureSha256: createHash('sha256').update(await readFile(join(host, 'crates/dbx-core/src/plugins/filesystem_integration.rs'))).digest('hex'),
  harnessSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  proxySha256: createHash('sha256').update(await readFile(new URL('./transfer-proxy.mjs', import.meta.url))).digest('hex'),
  firstSha256: createHash('sha256').update(await readFile(firstPackage)).digest('hex'),
  secondSha256: createHash('sha256').update(await readFile(secondPackage)).digest('hex') };
report.hostSourceSha256 = {};
for (const path of ['crates/dbx-core/src/plugins/download_leases.rs', 'crates/dbx-core/src/plugins/runtime.rs',
  'crates/dbx-core/src/plugins/filesystem_host.rs', 'Cargo.lock']) {
  report.hostSourceSha256[path] = createHash('sha256').update(await readFile(join(host, path))).digest('hex');
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function activation(profile) {
  const path = join(profile, 'plugins', id, 'activations');
  const records = [];
  for (const name of await readdir(path)) {
    if (/^\d+-.*\.json$/.test(name)) records.push(JSON.parse(await readFile(join(path, name), 'utf8')));
  }
  assert.ok(records.length);
  return records.sort((a, b) => b.sequence - a.sequence)[0];
}

try {
  for (const action of values.action === 'all' ? ['upgrade', 'rollback'] : [values.action]) {
    for (const direction of values.direction === 'all' ? ['upload', 'download'] : [values.direction]) {
      const runId = randomUUID();
      const control = await mkdtemp(join(tmpdir(), 'dbx-host-transfer-control-'));
      const proxy = await transferProxy(process.env.DBX_FM_WEBDAV_ENDPOINT ?? 'http://127.0.0.1:8080',
        { writeNamespace: `dbx-host-transfer-${runId}` });
      const row = { action, direction, runId, passed: false };
      report.cases.push(row);
      let stoppedPid;
      let ready;
      let rule;
      const child = spawn('cargo', ['test', '--locked', '--offline', '-p', 'dbx-core', '--lib',
        '--no-default-features', '--features', 'sqlite-bundled', 'real_file_manager_active_transfer_lifecycle', '--', '--ignored', '--nocapture'], {
        cwd: host, env: { ...process.env, DBX_FM_LIFECYCLE_CONTROL: control, DBX_FM_LIFECYCLE_RUN: runId,
          DBX_FM_LIFECYCLE_DIRECTION: direction, DBX_FM_LIFECYCLE_ACTION: action, DBX_FM_LIFECYCLE_ENDPOINT: proxy.endpoint,
          DBX_FM_LIFECYCLE_STOP_MODE: stopMode,
          DBX_FM_LIFECYCLE_FIRST_PACKAGE: firstPackage, DBX_FM_LIFECYCLE_SECOND_PACKAGE: secondPackage },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let logs = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-24000); });
      let exitResult;
      const closed = new Promise(resolve => child.once('close', (code, signal) => { exitResult = { code, signal }; resolve(exitResult); }));
      child.on('error', error => { logs += error.message; });
      async function marker(name, timeoutMs = 180000) {
        const deadline = performance.now() + timeoutMs;
        while (!(await exists(join(control, name)))) {
          if (exitResult) {
            const failure = await exists(join(control, 'failure.json'))
              ? JSON.parse(await readFile(join(control, 'failure.json'), 'utf8')).error
              : 'Host fixture exited';
            assert.fail(`${failure}; expected ${name}`);
          }
          assert.ok(performance.now() < deadline, `Host fixture did not emit ${name}`);
          await delay(10);
        }
        return JSON.parse(await readFile(join(control, name), 'utf8'));
      }
      try {
        ready = await marker('ready.json');
        row.profile = ready.profile;
        assert.equal(ready.runId, runId);
        assert.match(basename(ready.profile), /^dbx-host-transfer-profile-/);
        assert.ok(Number.isInteger(ready.oldPid) && ready.oldPid > 0);
        rule = proxy.arm(direction === 'upload' ? 'PUT' : 'GET', path => direction === 'upload'
          ? path.includes(`dbx-host-transfer-${runId}/dbx-upload-`) : path.endsWith(`dbx-host-transfer-${runId}/source.bin`));
        await writeFile(join(control, 'go'), 'go', { flag: 'wx' });
        await rule.waitBlocked();
        row.running = await marker('running.json', 20000);
        assert.equal(row.running.state, 'running');
        assert.ok(row.running.bytesTransferred > 0 && row.running.bytesTransferred < row.running.totalBytes);
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(ready.oldPid)], { encoding: 'utf8' });
        assert.ok(command.includes(ready.profile), 'Refusing to stop a process outside this fixture profile');
        process.kill(ready.oldPid, 'SIGSTOP');
        stoppedPid = ready.oldPid;
        assert.match(execFileSync('ps', ['-o', 'state=', '-p', String(stoppedPid)], { encoding: 'utf8' }), /T/);
        await writeFile(join(control, 'transition'), 'transition', { flag: 'wx' });
        await marker('transition-started.json', 20000);
        row.quiescing = await marker('quiescing.json', 20000);
        assert.equal(row.quiescing.poolDrained, true);
        row.activationWhileStopped = await activation(ready.profile);
        assert.equal(row.activationWhileStopped.version, ready.oldVersion, 'Replacement published before old process stopped');
        assert.equal(await exists(join(control, 'transition-done.json')), false);
        if (stopMode === 'graceful') {
          process.kill(stoppedPid, 'SIGCONT');
          stoppedPid = undefined;
        }
        const publicationDeadline = performance.now() + 40000;
        while (!(await exists(join(control, 'transition-done.json')))) {
          const record = await activation(ready.profile);
          let alive = true;
          try { process.kill(ready.oldPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
          assert.ok(!(alive && record.version === ready.newVersion), 'New version published while old process was alive');
          assert.ok(!exitResult && performance.now() < publicationDeadline, 'Host transition did not finish');
          await delay(5);
        }
        row.transition = await marker('transition-done.json', 40000);
        assert.equal(row.transition.stopMode, stopMode);
        assert.throws(() => process.kill(ready.oldPid, 0), error => error.code === 'ESRCH');
        stoppedPid = undefined;
        assert.equal((await activation(ready.profile)).version, ready.newVersion);
        row.oldProcessStoppedBeforePublication = true;
        rule.disarm();
        await rule.waitClosed();
        row.proxyStreams = rule.snapshots();
        await writeFile(join(control, 'drained'), 'drained', { flag: 'wx' });
        row.verified = await marker('verified.json', 30000);
        row.cleanup = await marker('cleanup.json', 30000);
        const result = await closed;
        assert.equal(result.code, 0, 'Host lifecycle test failed');
        assert.ok(row.cleanup.remoteCleaned && row.cleanup.processesStopped);
        assert.equal(await exists(ready.profile), false, 'Temporary host profile remains');
        row.passed = true;
        console.log(`PASS active ${direction} ${action} (${stopMode}): old-PID barrier, target/secret preservation, temporary cleanup and retry`);
      } catch (error) {
        row.failure = error.message;
        throw error;
      } finally {
        if (stoppedPid) {
          try {
            const command = execFileSync('ps', ['-o', 'command=', '-p', String(stoppedPid)], { encoding: 'utf8' });
            if (ready && command.includes(ready.profile)) process.kill(stoppedPid, 'SIGCONT');
          } catch {}
        }
        rule?.disarm();
        // Let the Rust test's bounded failure path clean its profile and remote files.
        if (!exitResult) await closed;
        row.exit = exitResult;
        row.hostOutput = logs;
        if (await exists(join(control, 'cleanup.json'))) row.cleanup = await marker('cleanup.json');
        if (await exists(join(control, 'post-stop.json'))) row.inspection = await marker('post-stop.json');
        if (ready) row.profileRemoved = !(await exists(ready.profile));
        await proxy.close();
        await rm(control, { recursive: true, force: true });
      }
    }
  }
  report.passed = true;
} finally {
  const folder = new URL('../docs/evidence/', import.meta.url);
  await mkdir(folder, { recursive: true });
  await writeFile(new URL(`host-transfer-lifecycle-${suiteId}.json`, folder), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Evidence: docs/evidence/host-transfer-lifecycle-${suiteId}.json`);
}
