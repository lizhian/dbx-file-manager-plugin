import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

test('imported Compose services bind only loopback and use relative config mounts', () => {
  const compose = parse(readFileSync(new URL('fixtures/file-manager/compose.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(compose.services).sort(), ['datanode', 'ftp', 'namenode', 's3', 's3-init', 'sftp', 'webdav']);
  for (const service of Object.values(compose.services)) {
    assert.match(service.image, /[:@]/, 'Service image must have a version or digest');
    for (const port of service.ports ?? []) assert.match(port, /^127\.0\.0\.1:/);
    for (const volume of service.volumes ?? []) assert.match(volume, /^\.\/(config|runtime)\//);
  }
  assert.match(compose.services.namenode.volumes.join(' '), /config\/hadoop\/server/);
  assert.match(compose.services.namenode.command[2], /if \[ ! -f \/tmp\/hadoop\/name\/current\/VERSION \]; then\s+hdfs namenode -format -force -nonInteractive\s+fi/);
});
test('fixture version-control candidates contain no runtime or target files', () => {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tests/fixtures/file-manager'],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim().split('\n');
  for (const path of paths) assert.doesNotMatch(path, /(^|\/)(runtime|target|id_ed25519|id_rsa)(\/|$)/);
});
test('native Hadoop fixture isolates ports and volumes without forcing amd64 runtime', () => {
  const original = parse(readFileSync(new URL('fixtures/file-manager/compose.yaml', import.meta.url), 'utf8'));
  const native = parse(readFileSync(new URL('fixtures/file-manager/compose.hadoop-native.yaml', import.meta.url), 'utf8'));
  const occupied = new Set(Object.values(original.services).flatMap(service => service.ports ?? [])
    .map(port => port.split(':')[1]));
  assert.deepEqual(Object.keys(native.services).sort(), ['datanode', 'namenode']);
  assert.deepEqual(Object.keys(native.volumes).sort(), ['native-data', 'native-name']);
  for (const service of Object.values(native.services)) {
    assert.equal(service.platform, undefined);
    assert.equal(service.pull_policy, 'never');
    for (const port of service.ports) {
      assert.match(port, /^127\.0\.0\.1:/);
      assert.ok(!occupied.has(port.split(':')[1]), 'Native fixture collides with existing ports');
    }
    for (const mount of service.volumes) assert.match(mount, /^(\.\/config\/|native-(data|name):)/);
    assert.equal(service.privileged, undefined);
    assert.equal(service.network_mode, undefined);
  }
  assert.match(native.services.namenode.command[2], /if \[ ! -f \/tmp\/hadoop\/name\/current\/VERSION \]; then/);
  const dockerfile = readFileSync(new URL('fixtures/file-manager/hadoop-native/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /FROM eclipse-temurin:11-jre@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /COPY --from=distribution \/opt\/hadoop \/opt\/hadoop/);
});
test('vendored schema is the negotiated host working-tree snapshot', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('schema/manifest.schema.json', import.meta.url))).digest('hex'),
    'f345e1f109b1aa53ff4275f3abd9bddf4f2171912e74e1e1c0f94b86ebdbab14');
});
test('GitHub workflow validates only, without release permissions or signing', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/validate.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(!('release' in workflow.on));
  assert.deepEqual(readdirSync(new URL('../.github/workflows/', import.meta.url)), ['validate.yml']);
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) assert.doesNotMatch(step.run ?? '', /publish|release create|sign|compose.*\b(up|down|restart)\b/);
  }
});
