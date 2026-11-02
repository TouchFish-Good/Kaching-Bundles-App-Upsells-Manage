import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { AdminStore } from '../server/store.js';

async function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-owner-auth-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  try { await store.ready(); await run(store); }
  finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('the single Owner signs in with password and receives an active session', async () => {
  await withStore(async (store) => {
    const owner = await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
    assert.equal(owner.role, 'Owner');
    assert.equal(await store.beginLogin('owner@example.com', 'wrong-password'), null);
    const session = await store.beginLogin('owner@example.com', 'strong-passphrase-123');
    assert.ok(session?.token);
    assert.equal((await store.authenticate(session.token)).email, 'owner@example.com');
    assert.equal((await store.authenticate(session.token)).role, 'Owner');
    await store.logout(session.token);
    assert.equal(await store.authenticate(session.token), null);
  });
});

test('only one active Owner account can exist', async () => {
  await withStore(async (store) => {
    await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
    await assert.rejects(
      store.createOwner({ email: 'other@example.com', password: 'another-passphrase-456' }),
      /single Owner|already exists/i,
    );
  });
});

test('only the original Owner can sign in when a legacy database has multiple Owners', async () => {
  await withStore(async (store) => {
    const owner = await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
    await store.run('INSERT INTO admin_users(id,email,password_hash,role,status,mfa_secret,created_at) VALUES(?,?,?,?,?,?,?)', [
      'legacy-owner', 'legacy@example.com', await argon2.hash('another-passphrase-456'), 'Owner', 'active', '', new Date(Date.now() + 1_000).toISOString(),
    ]);
    assert.ok(await store.beginLogin('owner@example.com', 'strong-passphrase-123'));
    assert.equal(await store.beginLogin('legacy@example.com', 'another-passphrase-456'), null);
    assert.equal(owner.role, 'Owner');
  });
});

test('existing sessions table does not add MFA state', async () => {
  await withStore(async (store) => {
    const columns = await store.all('PRAGMA table_info(admin_sessions)');
    assert.ok(!columns.some((column) => column.name === 'mfa_attempts'));
  });
});
