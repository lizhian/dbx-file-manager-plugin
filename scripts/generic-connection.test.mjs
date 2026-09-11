import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lifecyclePayload, summary, validateRecord } from '../devtools/mock-host/connections.mjs';

test('generic parameters bind exclusively to Secret Store and never enter summaries', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const provider = manifest.contributions.find(c => c.database_type === 'opendal');
  assert.equal(provider.fields.length, 3);
  assert.deepEqual(provider.fields.filter(f => f.key === 'parameters').map(f => [f.type, f.binding]), [['textarea', 'secret']]);
  const parameters = 'access_key_id=TEST_ONLY_SECRET\nsecret_access_key=WITH=EQUALS ';
  const record = validateRecord(manifest, { providerId: provider.id, values: { display_name: 'Generic S3', service: 's3', parameters } });
  const payload = lifecyclePayload(manifest, record);
  assert.deepEqual(payload.connection.external_config, {});
  assert.deepEqual(payload.connection.connection_secrets, { service: 's3', parameters });
  assert.equal(JSON.stringify(summary(manifest, record)).includes('TEST_ONLY_SECRET'), false);
  const empty = validateRecord(manifest, { providerId: provider.id, values: { display_name: 'Memory', service: 'memory', parameters: '' } });
  assert.equal(lifecyclePayload(manifest, empty).connection.connection_secrets.parameters, '');
});

test('S3 form defaults use OpenDAL path addressing and preserve an explicit virtual-host choice', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  const provider = manifest.contributions.find(c => c.database_type === 's3');
  const values = { display_name: 'S3 local', endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', bucket: 'dbx', access_key: 'TEST_ONLY', secret_key: 'TEST_ONLY', root: '/' };
  const payload = lifecyclePayload(manifest, validateRecord(manifest, { providerId: provider.id, values }));
  assert.equal(payload.connection.connection_secrets.path_style, 'true');
  const explicit = lifecyclePayload(manifest, validateRecord(manifest, { providerId: provider.id, values: { ...values, path_style: 'false' } }));
  assert.equal(explicit.connection.connection_secrets.path_style, 'false');
});
