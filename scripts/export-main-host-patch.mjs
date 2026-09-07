import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(process.argv[2] || join(root, '../dbx-file-manager-main'));
const base = '14e1d4f25b7f352a0ed50edf019e698e80bcf5d9';
const framework = 'c26ff3f6d4bd643be8dedd659c3236af4a5bd556';
const output = join(root, 'docs/host-main-14e1d4f-api-1.1.patch');
// Explicit allowlist: never sweep untracked runtime data or credentials into a patch.
const extraSources = ['crates/dbx-core/examples/file_manager_desktop_fixture.rs', 'crates/dbx-core/src/plugins/lifecycle.rs',
  'crates/dbx-core/src/plugins/download_leases.rs',
  'apps/desktop/src/stores/__tests__/connectionStore.pluginDefaults.spec.ts'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function git(args, env = process.env, allowedStatus = 0) {
  const result = spawnSync('git', args, { cwd: host, env, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, allowedStatus, result.stderr.toString());
  return result.stdout;
}

assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), base, 'Unexpected main baseline');
assert.equal(git(['ls-files', '-u']).length, 0, 'Unresolved merge conflicts');
const index = resolve(host, git(['rev-parse', '--git-path', 'index']).toString().trim());
const indexBefore = sha256(readFileSync(index));
const historical = join(root, 'docs/host-api-1.1.patch');
const historicalBefore = sha256(readFileSync(historical));
if (existsSync(output)) {
  const recorded = JSON.parse(readFileSync(`${output}.json`, 'utf8'));
  assert.equal(sha256(readFileSync(output)), recorded.sha256, 'Existing export was edited outside this exporter');
}

const chunks = [git(['diff', '--binary', '--full-index', base, '--'])];
const changed = new Set(git(['diff', '--name-only', base]).toString().trim().split('\n').filter(Boolean));
const includedUntrackedFiles = [];
for (const file of extraSources) {
  if (git(['ls-files', '--', file]).length) continue;
  chunks.push(git(['diff', '--no-index', '--binary', '--full-index', '--', '/dev/null', file], process.env, 1));
  changed.add(file);
  includedUntrackedFiles.push(file);
}
const patch = Buffer.concat(chunks);
const temporary = mkdtempSync(join(tmpdir(), 'dbx-main-export-'));
try {
  const candidate = join(temporary, 'host.patch');
  writeFileSync(candidate, patch);
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
  git(['read-tree', base], env);
  git(['apply', '--cached', '--check', candidate], env);
  git(['apply', '--cached', candidate], env);
  const resultTree = git(['write-tree'], env).toString().trim();
  git(['apply', '--reverse', '--check', candidate]);
  assert.equal(sha256(readFileSync(index)), indexBefore, 'Real index changed');
  assert.equal(sha256(readFileSync(historical)), historicalBefore, 'Historical patch changed');
  const metadata = {
    base, framework, resultTree, patch: basename(output), sha256: sha256(patch),
    bytes: patch.length, changedFiles: changed.size, includedUntrackedFiles,
    checkedApply: true, checkedReverse: true, realIndexUnchanged: true, oldPatchUnchanged: true,
  };
  writeFileSync(output, patch);
  writeFileSync(`${output}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify(metadata, null, 2));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
