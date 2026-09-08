import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('relaunch config contains production and staging URLs', async () => {
  const config = JSON.parse(await fs.readFile(new URL('./config/relaunch.config.json', import.meta.url), 'utf8'));
  assert.equal(new URL(config.productionBaseUrl).hostname, 'halteverbot123.de');
  assert.equal(new URL(config.stagingBaseUrl).hostname, 'storyblok.halteverbot123.de');
  assert.ok(Array.isArray(config.criticalPaths));
  assert.ok(config.criticalPaths.length > 0);
});

test('check catalog IDs are unique', async () => {
  const catalog = JSON.parse(await fs.readFile(new URL('./config/check-catalog.json', import.meta.url), 'utf8'));
  const ids = catalog.flatMap((phase) => phase.checks.map((check) => check.id));
  assert.equal(new Set(ids).size, ids.length);
});
