import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

test('does not ship the retired Node server runtime or its test-only dependencies', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  for (const dependency of ['express', 'sqlite3', 'argon2', 'otplib', 'qrcode']) {
    assert.equal(manifest.dependencies?.[dependency], undefined);
  }
  for (const dependency of ['@types/express', '@types/qrcode']) {
    assert.equal(manifest.devDependencies?.[dependency], undefined);
  }
  await assert.rejects(stat('server'));
  await assert.rejects(stat('test/browser-smoke.mjs'));
  await assert.rejects(stat('test/ui-state.test.js'));
});
