import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../tests/package.json', import.meta.url));
const Ajv = require('ajv/dist/2020');
const { parse } = require('smol-toml');
export const root = fileURLToPath(new URL('../', import.meta.url));
export const protocols = ['ftp', 'sftp', 's3', 'webdav', 'webhdfs', 'hdfs-native'];
export const pluginId = 'io.github.lizhian.file-manager';
export const staticCapabilities = ['list', 'stat', 'read', 'write', 'delete', 'rename', 'mkdir', 'copy', 'upload', 'download'];
export const readJson = (path) => JSON.parse(readFileSync(new URL(path, pathToFileURL(root)), 'utf8'));
const schema = readJson('tests/schema/manifest.schema.json');
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);

export const fieldsByProtocol = {
  ftp: { name: ['display_name'], host: ['host'], port: ['port'], username: ['username'], config: ['root'], secret: ['password'] },
  sftp: { name: ['display_name'], host: ['host'], port: ['port'], username: ['username'], config: ['root', 'authentication'], secret: ['private_key'] },
  s3: { name: ['display_name'], config: ['root', 'endpoint', 'region', 'bucket', 'path_style'], secret: ['access_key', 'secret_key', 'session_token'] },
  webdav: { name: ['display_name'], username: ['username'], config: ['root', 'endpoint', 'authentication'], secret: ['password', 'bearer_token'] },
  webhdfs: { name: ['display_name'], config: ['root', 'endpoint', 'simple_user', 'use_delegation_token'], secret: ['delegation_token'] },
  'hdfs-native': { name: ['display_name'], config: ['root', 'name_node_uri', 'hadoop_config_directory'] },
};

const sorted = (items) => [...items].sort();
export function validateManifest(manifest) {
  assert.ok(validateSchema(manifest), JSON.stringify(validateSchema.errors));
  assert.equal(manifest.id, pluginId);
  assert.equal(manifest.publisher, 'lizhian');
  assert.equal(manifest.engines.host_api, '>=1.1.0, <2.0.0');
  assert.deepEqual(manifest.permissions, ['host.events']);
  assert.deepEqual(Object.keys(manifest.entrypoints), ['backend']);
  assert.equal(manifest.entrypoints.backend.transport, 'stdio-framed');
  assert.deepEqual(manifest.entrypoints.backend.protocol_versions, [1]);
  assert.equal(manifest.contributions.length, 12);
  const ids = manifest.contributions.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate contribution IDs');
  for (const protocol of protocols) {
    const connection = manifest.contributions.find((c) => c.id === `${pluginId}.${protocol}`);
    const filesystem = manifest.contributions.find((c) => c.id === `${connection?.id}.files`);
    assert.equal(connection?.type, 'connection-provider', protocol);
    assert.equal(connection.database_type, protocol);
    assert.equal(filesystem?.type, 'filesystem-provider', protocol);
    assert.equal(connection.filesystem_provider, filesystem.id);
    assert.ok(!('workbench' in connection));
    assert.deepEqual(connection.capabilities, ['test', 'connect', 'disconnect']);
    assert.deepEqual(filesystem.schemes, [protocol]);
    assert.equal(filesystem.root_uri, `${protocol}:/`);
    assert.deepEqual(sorted(filesystem.capabilities), sorted(staticCapabilities));
    assert.equal(new Set(connection.fields.map((f) => f.key)).size, connection.fields.length);
    const bindings = {};
    for (const field of connection.fields) {
      (bindings[field.binding] ??= []).push(field.key);
      assert.equal(typeof field.required, 'boolean', `${protocol}.${field.key}: explicit required`);
      if (field.binding === 'secret') {
        assert.equal(field.type, 'password');
        assert.ok(!('default' in field), `${protocol}.${field.key}: no secret defaults`);
      }
      if (field.type === 'select') {
        assert.equal(new Set(field.options.map((o) => o.value)).size, field.options.length);
        assert.ok(field.options.some((o) => o.value === field.default));
      }
    }
    assert.deepEqual(Object.fromEntries(Object.entries(bindings).map(([k, v]) => [k, sorted(v)])),
      Object.fromEntries(Object.entries(fieldsByProtocol[protocol]).map(([k, v]) => [k, sorted(v)])));
    const field = (key) => connection.fields.find((f) => f.key === key);
    assert.equal(field('root').default, '/');
    assert.equal(field('root').required, true);
    if (['ftp', 'sftp'].includes(protocol)) assert.equal(field('port').default, protocol === 'ftp' ? 21 : 22);
    if (protocol === 'sftp') {
      assert.deepEqual(field('authentication').options.map((o) => o.value), ['ssh_config', 'ssh_agent', 'private_key']);
      assert.equal(field('private_key').required, false);
      assert.equal(field('username').required, false);
    }
    if (protocol === 'webdav') {
      assert.deepEqual(field('authentication').options.map((o) => o.value), ['basic', 'bearer']);
      for (const key of ['username', 'password', 'bearer_token']) assert.equal(field(key).required, false);
    }
    if (protocol === 'webhdfs') {
      assert.equal(field('use_delegation_token').type, 'boolean');
      assert.equal(field('use_delegation_token').default, false);
      for (const key of ['simple_user', 'delegation_token']) assert.equal(field(key).required, false);
    }
  }
  const localized = manifest.localizations['zh-CN'].contributions;
  assert.deepEqual(sorted(Object.keys(localized)), sorted(ids));
  for (const c of manifest.contributions) {
    assert.ok(localized[c.id].label);
    if (c.fields) {
      assert.deepEqual(sorted(Object.keys(localized[c.id].fields)), sorted(c.fields.map((f) => f.key)));
      for (const f of c.fields.filter((f) => f.options)) {
        assert.deepEqual(sorted(Object.keys(localized[c.id].fields[f.key].options)), sorted(f.options.map((o) => o.value)));
      }
    }
  }
  return manifest;
}

export function validatePackage(manifest, text) {
  const config = parse(text);
  assert.equal(config.schema_version, 1);
  assert.equal(config.backend.language, 'rust');
  assert.equal(config.backend.directory, 'backend');
  assert.equal(manifest.entrypoints.backend.executable, `bin/${config.backend.binary}`);
  assert.deepEqual(config.package.include, ['assets', 'LICENSE', 'NOTICE']);
}

export function validateBackendVersions(manifest, cargoText, lockText) {
  const backend = parse(cargoText).package;
  const lockedBackend = parse(lockText).package.find((pkg) => pkg.name === backend.name && !pkg.source);
  assert.equal(backend.version, manifest.version, 'Backend and manifest versions differ');
  assert.equal(lockedBackend?.version, manifest.version, 'Lockfile and manifest versions differ');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const manifest = validateManifest(readJson('manifest.json'));
    validatePackage(manifest, readFileSync(new URL('../dbx-plugin.toml', import.meta.url), 'utf8'));
    validateBackendVersions(manifest,
      readFileSync(new URL('../backend/Cargo.toml', import.meta.url), 'utf8'),
      readFileSync(new URL('../backend/Cargo.lock', import.meta.url), 'utf8'));
    console.log('Manifest schema, six-provider contract and package metadata valid. Runtime acceptance is not tested.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
