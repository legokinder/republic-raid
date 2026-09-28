import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../scripts/config.mjs';

async function fixture(t, contents) {
  const directory = await mkdtemp(join(tmpdir(), 'raid-config-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'config.json');
  if (contents !== undefined) await writeFile(configPath, contents);
  return configPath;
}

test('missing local config uses defaults without an implicit identity', async (t) => {
  const configPath = await fixture(t);
  assert.deepEqual(await loadConfig({ env: {}, configPath }), {
    port: 19227, expectedXAccount: null, expectedRepublicAccount: null,
  });
});

test('local identities are normalized and the configured port is retained', async (t) => {
  const configPath = await fixture(t, JSON.stringify({
    port: 23456, expectedXAccount: 'Example_User', expectedRepublicAccount: ' sample-republic ',
  }));
  assert.deepEqual(await loadConfig({ env: {}, configPath }), {
    port: 23456, expectedXAccount: '@example_user', expectedRepublicAccount: 'sample-republic',
  });
});

test('environment configuration overrides local configuration', async (t) => {
  const configPath = await fixture(t, JSON.stringify({
    port: 23456, expectedXAccount: 'example_user', expectedRepublicAccount: 'sample-republic',
  }));
  assert.deepEqual(await loadConfig({ configPath, env: {
    RAID_CDP_PORT: '23457', RAID_EXPECTED_X_ACCOUNT: '@OTHER_USER',
    RAID_EXPECTED_REPUBLIC_ACCOUNT: ' other-republic ',
  } }), {
    port: 23457, expectedXAccount: '@other_user', expectedRepublicAccount: 'other-republic',
  });
});

test('blank account environment variables clear saved identities', async (t) => {
  const configPath = await fixture(t, JSON.stringify({
    expectedXAccount: 'example_user', expectedRepublicAccount: 'sample-republic',
  }));
  const config = await loadConfig({ configPath, env: {
    RAID_EXPECTED_X_ACCOUNT: ' ', RAID_EXPECTED_REPUBLIC_ACCOUNT: '',
  } });
  assert.equal(config.expectedXAccount, null);
  assert.equal(config.expectedRepublicAccount, null);
});

test('blank file identities mean no configured identity', async (t) => {
  const configPath = await fixture(t, JSON.stringify({
    expectedXAccount: '', expectedRepublicAccount: ' ',
  }));
  const config = await loadConfig({ env: {}, configPath });
  assert.equal(config.expectedXAccount, null);
  assert.equal(config.expectedRepublicAccount, null);
});

test('port boundaries are accepted', async (t) => {
  const configPath = await fixture(t);
  for (const port of [1024, 65535]) {
    assert.equal((await loadConfig({ configPath, env: { RAID_CDP_PORT: String(port) } })).port, port);
  }
});

test('invalid ports reject instead of silently using a default', async (t) => {
  const configPath = await fixture(t);
  for (const port of ['', '1023', '65536', '1234.5', 'NaN', '23456suffix']) {
    await assert.rejects(loadConfig({ configPath, env: { RAID_CDP_PORT: port } }));
  }
  for (const port of [null, true, [], {}, 1234.5]) {
    await writeFile(configPath, JSON.stringify({ port }));
    await assert.rejects(loadConfig({ configPath, env: {} }));
  }
});

test('invalid handles and account types reject without disclosing values', async (t) => {
  const configPath = await fixture(t);
  for (const value of ['private-marker!', 'abcdefghijklmnop', '@@example_user', 'example user', 42, {}, []]) {
    await writeFile(configPath, JSON.stringify({ expectedXAccount: value }));
    await assert.rejects(loadConfig({ configPath, env: {} }), (error) => {
      if (typeof value === 'string') assert.ok(!error.message.includes(value));
      return true;
    });
  }
  for (const value of [42, true, {}, []]) {
    await writeFile(configPath, JSON.stringify({ expectedRepublicAccount: value }));
    await assert.rejects(loadConfig({ configPath, env: {} }));
  }
});

test('malformed JSON, non-object config, and unknown keys fail safely', async (t) => {
  const configPath = await fixture(t);
  for (const contents of ['{"private-marker":', 'null', '[]', '"private-marker"',
    '{"private-marker":"private-value"}']) {
    await writeFile(configPath, contents);
    await assert.rejects(loadConfig({ configPath, env: {} }), (error) => {
      assert.ok(!error.message.includes('private-marker'));
      assert.ok(!error.message.includes('private-value'));
      assert.ok(!error.message.includes(configPath));
      return true;
    });
  }
});
