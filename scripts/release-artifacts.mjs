import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, validateManifest, validateBackendVersions } from './validate-manifest.mjs';

export const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'windows-x64'];

export function checkTag(tag, version) {
  assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(tag, `v${version}`, 'Tag and manifest version must agree');
}

export function checkMetadata(metadata, manifest, target) {
  assert.ok(targets.includes(target), 'Unsupported target');
  assert.equal(metadata.target, target);
  assert.equal(metadata.url, `${manifest.id}-${manifest.version}-${target}.dbxp`);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(metadata.size) && metadata.size > 0);
  assert.ok(!('signingKeyId' in metadata), 'Expected unsigned candidate');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = validateManifest(readJson('manifest.json'));
  validateBackendVersions(manifest, readFileSync('backend/Cargo.toml', 'utf8'), readFileSync('backend/Cargo.lock', 'utf8'));
  checkTag(process.env.GITHUB_REF_NAME, manifest.version);
  const mode = process.argv[2];
  if (mode !== 'check-tag') {
    assert.ok(['check-target', 'merge'].includes(mode), 'Unknown release operation');
    const folder = process.argv[3] ?? (mode === 'merge' ? 'release-assets' : 'dist');
    const expectedTargets = mode === 'merge' ? targets : [process.env.DBX_PLUGIN_TARGET];
    const artifacts = expectedTargets.map(target => {
      const stem = `${manifest.id}-${manifest.version}-${target}`;
      const metadata = JSON.parse(readFileSync(join(folder, `${stem}.artifact.json`), 'utf8'));
      checkMetadata(metadata, manifest, target);
      execFileSync(process.execPath, ['scripts/verify-package.mjs', join(folder, metadata.url)], { stdio: 'inherit' });
      return metadata;
    });
    const expected = artifacts.flatMap(a => [a.url, a.url.replace(/\.dbxp$/, '.artifact.json')]).sort();
    assert.deepEqual(readdirSync(folder).filter(n => n !== 'release-candidates.json').sort(), expected, 'Unexpected or missing release files');
    if (mode === 'merge') {
      const { id, name, description, publisher, version, permissions } = manifest;
      writeFileSync(join(folder, 'release-candidates.json'), `${JSON.stringify({ plugin: { id, name, description, publisher, version, permissions }, artifacts }, null, 2)}\n`);
    }
  }
}
