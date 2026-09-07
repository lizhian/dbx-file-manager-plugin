import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, isAbsolute, join } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function signedPackageFixture(packager, inputs, directory) {
  assert.ok(packager && isAbsolute(packager), 'Set absolute DBX_PLUGIN_PACKAGER_BINARY for signed acceptance');
  await mkdir(directory, { recursive: true });
  const keyId = `fixture.${randomUUID()}`;
  const keys = generateKeyPairSync('ed25519');
  const seed = Buffer.from(keys.privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const alternate = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  const alternatePublicKey = Buffer.from(alternate.x, 'base64url').toString('base64');
  const packages = [];
  for (const input of inputs) {
    const output = join(directory, basename(input).replace(/\.dbxp$/, '.signed.dbxp'));
    const result = spawnSync(packager, ['sign', input, output, '--key-id', keyId], {
      env: { ...process.env, DBX_PLUGIN_SIGNING_KEY: seed }, encoding: 'utf8', timeout: 30000,
    });
    // Do not include a signing subprocess's environment or output in an exception.
    assert.equal(result.status, 0, 'Fixture package signing failed');
    const signature = JSON.parse(execFileSync('unzip', ['-p', output, 'signature.json'], { encoding: 'utf8' }));
    assert.equal(signature.key_id, keyId);
    assert.equal(signature.algorithm, 'ed25519');
    packages.push(output);
  }
  const tampered = join(directory, 'tampered.dbxp');
  await copyFile(packages[1], tampered);
  const signature = JSON.parse(execFileSync('unzip', ['-p', tampered, 'signature.json'], { encoding: 'utf8' }));
  const bytes = Buffer.from(signature.signature, 'base64');
  bytes[0] ^= 1;
  signature.signature = bytes.toString('base64');
  const signaturePath = join(directory, 'signature.json');
  await writeFile(signaturePath, JSON.stringify(signature));
  execFileSync('zip', ['-q', '-j', tampered, signaturePath]);
  const members = execFileSync('unzip', ['-Z1', tampered], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(members.filter((member) => member === 'signature.json').length, 1);
  return { keyId, publicKey, alternatePublicKey, packages, tampered };
}

export async function fixtureMarketplace(fixture) {
  const signed = await readFile(fixture.packages[1]);
  const manifest = JSON.parse(execFileSync('unzip', ['-p', fixture.packages[1], 'manifest.json'], { encoding: 'utf8' }));
  const repositoryId = `fixture-${randomUUID()}`;
  const catalog = {
    catalogVersion: 1,
    repository: { id: repositoryId, name: 'Local lifecycle acceptance' },
    plugins: [{ id: manifest.id, name: manifest.name, publisher: manifest.publisher,
      permissions: manifest.permissions, latestVersion: manifest.version,
      versions: [{ version: manifest.version, artifacts: [{ target: `${process.platform}-${process.arch}`,
        url: 'package.dbxp', sha256: digest(signed), size: signed.length, signingKeyId: fixture.keyId }] }] }],
  };
  let mismatch;
  const server = createServer((request, response) => {
    if (request.url === '/package.dbxp') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(signed);
    } else if (request.url === '/catalog.json') {
      const document = structuredClone(catalog);
      if (mismatch === 'publisher') document.plugins[0].publisher = 'different.publisher';
      if (mismatch === 'permissions') document.plugins[0].permissions = [];
      if (mismatch === 'signing-key') document.plugins[0].versions[0].artifacts[0].signingKeyId = 'different.fixture';
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(document));
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    repository: { id: repositoryId, name: catalog.repository.name, kind: 'custom', managed: false,
      enabled: true, catalogUrl: `http://127.0.0.1:${server.address().port}/catalog.json` },
    request: { repositoryId, pluginId: manifest.id, version: manifest.version },
    mismatch(field) {
      assert.ok(field === undefined || ['publisher', 'permissions', 'signing-key'].includes(field));
      mismatch = field;
    },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
