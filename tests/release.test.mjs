import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { targets, checkTag, checkMetadata } from '../scripts/release-artifacts.mjs';

test('release tags must match the source version', () => {
  checkTag('v0.1.1', '0.1.1');
  checkTag('v0.2.0-rc.1', '0.2.0-rc.1');
  for (const tag of ['main', 'v0.1.0', 'v0.1.1;echo bad']) assert.throws(() => checkTag(tag, '0.1.1'));
});
test('official artifact naming binds identity, version and target', () => {
  const manifest = { id: 'io.github.lizhian.file-manager', version: '0.1.1' };
  for (const target of targets) {
    const metadata = { target, url: `${manifest.id}-${manifest.version}-${target}.dbxp`, size: 123, sha256: 'a'.repeat(64) };
    checkMetadata(metadata, manifest, target);
    for (const changes of [{ url: '../other.dbxp' }, { size: -1 }, { sha256: 'bad' }, { signingKeyId: 'key' }, { target: 'universal' }]) {
      assert.throws(() => checkMetadata({ ...metadata, ...changes }, manifest, target));
    }
  }
});
test('release publishes only after the full official five-target matrix succeeds', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.push, { tags: ['v*'] });
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.build.needs, 'validate');
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false);
  assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(v => v.target).sort(), targets);
  assert.equal(workflow.jobs.publish.needs, 'build');
  assert.deepEqual(workflow.jobs.publish.permissions, { contents: 'write' });
  const publish = workflow.jobs.publish.steps.at(-1);
  assert.equal(publish.env.GH_REPO, '${{ github.repository }}');
  assert.match(publish.run, /--verify-tag --draft/);
  assert.match(publish.run, /release-candidates\.json/);
  const linker = workflow.jobs.build.steps.find(step => step.name?.startsWith('Pin the MSVC'));
  assert.equal(linker.shell, 'pwsh');
  assert.match(linker.run, /CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER/);
  assert.equal(workflow.jobs.build.steps[0].run, 'git config --global core.autocrlf false');
  assert.equal(workflow.jobs.build.steps[0].if, "runner.os == 'Windows'");
  assert.match(readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8'), /text=auto eol=lf/);
  for (const job of Object.values(workflow.jobs)) {
    assert.match(job.steps.find(step => step.uses === 'actions/checkout@v4').with.ref, /refs\/tags/);
  }
});
