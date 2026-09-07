import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import { validateManifest, validatePackage, validateBackendVersions, readJson } from '../scripts/validate-manifest.mjs';

const manifest = readJson('manifest.json');
test('manifest matches pinned host schema and all six provider contracts', () => validateManifest(manifest));
test('accepts a new package version without changing the provider contract', () => {
  validateManifest({ ...structuredClone(manifest), version: '0.1.1' });
});
test('requires manifest, compiled backend and root lock entry versions to agree', () => {
  const cargoText = readFileSync(new URL('../backend/Cargo.toml', import.meta.url), 'utf8');
  const lockText = readFileSync(new URL('../backend/Cargo.lock', import.meta.url), 'utf8');
  validateBackendVersions(manifest, cargoText, lockText);
  const next = { ...manifest, version: '0.1.1' };
  const cargo = parse(cargoText);
  cargo.package.version = next.version;
  assert.throws(() => validateBackendVersions(next, cargoText, lockText), /Backend and manifest/);
  assert.throws(() => validateBackendVersions(next, stringify(cargo), lockText), /Lockfile and manifest/);
  const lock = parse(lockText);
  lock.package.find((pkg) => pkg.name === cargo.package.name && !pkg.source).version = next.version;
  validateBackendVersions(next, stringify(cargo), stringify(lock));
});
test('package excludes generated UI and includes license attribution', () => {
  validatePackage(manifest, readFileSync(new URL('../dbx-plugin.toml', import.meta.url), 'utf8'));
});
test('backend identity, portable SDK pin and lock agree with manifest baseline', () => {
  const backend = parse(readFileSync(new URL('../backend/Cargo.toml', import.meta.url), 'utf8'));
  assert.equal(backend.package.version, manifest.version);
  assert.equal(backend.package.license, 'Apache-2.0');
  assert.equal(manifest.entrypoints.backend.executable, `bin/${backend.package.name}`);
  const sdk = backend.dependencies['dbx-plugin-sdk'];
  assert.deepEqual(sdk, { git: 'https://github.com/t8y2/dbx.git', rev: 'c26ff3f6d4bd643be8dedd659c3236af4a5bd556' });
  const lock = parse(readFileSync(new URL('../backend/Cargo.lock', import.meta.url), 'utf8'));
  const lockedSdk = lock.package.find((p) => p.name === 'dbx-plugin-sdk');
  assert.equal(lockedSdk.source, `git+${sdk.git}?rev=${sdk.rev}#${sdk.rev}`);
});
test('preserves Apache license verbatim from the source commit', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../LICENSE', import.meta.url))).digest('hex'),
    'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4');
  assert.match(readFileSync(new URL('../NOTICE', import.meta.url), 'utf8'), /149488ba1a6244d5ca9528eedf90481bc99fbf3d/);
});
test('security warnings survive in English and Chinese', () => {
  const connection = (p) => manifest.contributions.find((c) => c.database_type === p);
  const localized = (p) => manifest.localizations['zh-CN'].contributions[connection(p).id];
  assert.match(connection('ftp').description, /plaintext/i);
  assert.match(localized('ftp').description, /明文/);
  assert.match(connection('sftp').description, /Unix only/);
  assert.match(localized('sftp').description, /Unix/);
  assert.match(connection('hdfs-native').description, /local path/);
  assert.match(localized('hdfs-native').description, /本地路径/);
});

const mutations = {
  'duplicate provider ID': (m) => { m.contributions[1].id = m.contributions[0].id; },
  'cross-provider filesystem routing': (m) => { m.contributions[0].filesystem_provider = m.contributions[3].id; },
  'wrong root scheme': (m) => { m.contributions[1].root_uri = 'ssh:/'; },
  'invented capability': (m) => { m.contributions[1].capabilities.push('dynamic'); },
  'conditional field syntax': (m) => { m.contributions[0].fields[0].when = 'basic'; },
  'secret persisted as config': (m) => { m.contributions[0].fields.find((f) => f.key === 'password').binding = 'config'; },
  'public host persisted as config': (m) => { m.contributions[0].fields.find((f) => f.key === 'host').binding = 'config'; },
  'secret default leakage': (m) => { m.contributions[0].fields.find((f) => f.key === 'password').default = 'unsafe'; },
  'nested external config key': (m) => { m.contributions[0].fields.find((f) => f.key === 'root').key = 'ftp.root'; },
  'private key required for all auth modes': (m) => { m.contributions[2].fields.find((f) => f.key === 'private_key').required = true; },
  'wrong authentication enum': (m) => { m.contributions[2].fields.find((f) => f.key === 'authentication').options[0].value = 'password'; },
  'stale localization': (m) => { m.localizations['zh-CN'].contributions.stale = { label: 'old' }; },
  'custom UI entrypoint': (m) => { m.entrypoints.ui = { root: 'ui', entry: 'ui/index.html' }; },
  'unnecessary binary permission': (m) => { m.permissions.push('host.binary'); },
  'unframed transport': (m) => { m.entrypoints.backend.transport = 'stdio-jsonl'; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => validateManifest(changed));
  });
}
