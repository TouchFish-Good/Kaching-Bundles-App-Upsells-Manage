import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/reset-owner-password.mjs', import.meta.url));

test('reset owner password rejects short passwords without emitting SQL', async () => {
  await assert.rejects(
    run(process.execPath, [script], {
      env: { ...process.env, ADMIN_OWNER_EMAIL: 'owner@example.com', ADMIN_OWNER_PASSWORD: 'too-short' },
    }),
    (error) => error.code !== 0 && /at least 12 characters/i.test(String(error.stderr)) && !String(error.stdout).includes('UPDATE'),
  );
});

test('reset owner password emits a lock-guarded update without the raw password', async () => {
  const password = 'replacement-owner-password-123';
  const { stdout } = await run(process.execPath, [script], {
    env: { ...process.env, ADMIN_OWNER_EMAIL: 'owner@example.com', ADMIN_OWNER_PASSWORD: password },
  });

  assert.match(stdout, /UPDATE admin_users SET password_record/);
  assert.match(stdout, /admin_owner_lock/);
  assert.doesNotMatch(stdout, /\b(BEGIN|COMMIT)\b/);
  assert.doesNotMatch(stdout, new RegExp(password));
});
