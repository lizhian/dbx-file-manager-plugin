import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('host active-transfer fixture rejects missing or relative inputs before launching the host', () => {
  const script = fileURLToPath(new URL('../scripts/host-transfer-lifecycle-contract.mjs', import.meta.url));
  for (const args of [[], ['relative-host', 'first.dbxp', 'second.dbxp']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: node scripts\/host-transfer-lifecycle-contract|requires Unix/);
  }
});

test('host active-transfer fixture rejects invalid fault selectors before opening host inputs', () => {
  const script = fileURLToPath(new URL('../scripts/host-transfer-lifecycle-contract.mjs', import.meta.url));
  for (const [option, expected] of [
    ['--direction=delete', /Invalid direction|requires Unix/],
    ['--action=uninstall', /Invalid action|requires Unix/],
    ['--force-stop=maybe', /does not take an argument|requires Unix/],
    ['--unknown', /Unknown option|requires Unix/],
  ]) {
    const result = spawnSync(process.execPath, [script, option], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, expected);
  }
});
