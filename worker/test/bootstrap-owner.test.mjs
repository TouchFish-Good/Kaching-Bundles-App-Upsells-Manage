import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/bootstrap-owner.mjs', import.meta.url));

test('bootstrap owner rejects short passwords without emitting SQL', async () => {
  await assert.rejects(
    run(process.execPath, [script], {
      env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: 'owner@example.com', ADMIN_BOOTSTRAP_PASSWORD: 'too-short' },
    }),
    (error) => error.code !== 0 && /at least 12 characters/i.test(String(error.stderr)) && !String(error.stdout).includes('INSERT'),
  );
});

test('bootstrap owner emits guarded SQL without the raw password', async () => {
  const password = 'valid-owner-password-123';
  const { stdout } = await run(process.execPath, [script], {
    env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: 'owner@example.com', ADMIN_BOOTSTRAP_PASSWORD: password },
  });

  assert.match(stdout, /INSERT INTO admin_users/);
  assert.match(stdout, /WHERE NOT EXISTS/);
  assert.doesNotMatch(stdout, new RegExp(password));
});
