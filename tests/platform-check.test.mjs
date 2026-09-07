import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Linux platform runner refuses execution without explicit container context', () => {
  const env = { ...process.env };
  delete env.DBX_PLATFORM_CONTAINER;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/linux-platform-check.mjs', import.meta.url))],
    { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run in the isolated Linux platform container/);
});

test('Linux tooling image pins base images and does not copy repository or secret files', () => {
  const dockerfile = readFileSync(new URL('platform/linux/Dockerfile', import.meta.url), 'utf8');
  const from = dockerfile.split('\n').filter(line => line.startsWith('FROM '));
  assert.equal(from.length, 2);
  for (const line of from) assert.match(line, /@sha256:[a-f0-9]{64}/);
  const copies = dockerfile.split('\n').filter(line => line.startsWith('COPY '));
  assert.ok(copies.length > 0);
  for (const line of copies) assert.match(line, /^COPY --from=node \/usr\/local\//);
  assert.match(dockerfile, /@dbx-app\/plugin-cli@0\.1\.0 --ignore-scripts/);
});
