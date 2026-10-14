import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import { AdminStore } from '../server/store.js';

async function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-admin-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  try { await store.ready(); await run(store); }
  finally { await store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('password and MFA are both required for an authenticated session', async () => {
  await withStore(async (store) => {
    const secret = authenticator.generateSecret();
    await store.createUser({ email: 'owner@example.com', password: 'strong-passphrase-123', role: 'Owner', mfaSecret: secret });
    assert.equal(await store.beginLogin('owner@example.com', 'wrong-password'), null);
    const pending = await store.beginLogin('owner@example.com', 'strong-passphrase-123');
    assert.ok(pending);
    assert.equal(await store.authenticate(pending), null);
    assert.equal(await store.completeLogin(pending, '000000'), null);
    const session = await store.completeLogin(pending, authenticator.generate(secret));
    assert.ok(session?.token);
    assert.equal((await store.authenticate(session.token)).role, 'Owner');
    await store.logout(session.token);
    assert.equal(await store.authenticate(session.token), null);
  });
});

test('disabled user loses their session and the last Owner cannot be disabled', async () => {
  await withStore(async (store) => {
    const secret = authenticator.generateSecret();
    const owner = await store.createUser({ email: 'owner@example.com', password: 'strong-passphrase-123', role: 'Owner', mfaSecret: secret });
    const viewer = await store.createUser({ email: 'viewer@example.com', password: 'strong-passphrase-123', role: 'Viewer', mfaSecret: secret });
    const pending = await store.beginLogin('viewer@example.com', 'strong-passphrase-123');
    const session = await store.completeLogin(pending, authenticator.generate(secret));
    await store.disableUser(owner.id, viewer.id);
    assert.equal(await store.authenticate(session.token), null);
    await assert.rejects(store.disableUser(owner.id, owner.id), /last Owner/);
  });
});

test('an invitation is single-use and requires its MFA code', async () => {
  await withStore(async (store) => {
    const owner = await store.createUser({ email: 'owner@example.com', password: 'strong-passphrase-123', role: 'Owner', mfaSecret: authenticator.generateSecret() });
    const invitation = await store.createInvitation(owner.id, 'operator@example.com', 'Operator');
    const details = await store.getInvitation(invitation.token);
    assert.equal(details.email, 'operator@example.com');
    assert.equal(await store.activateInvitation(invitation.token, 'strong-passphrase-456', '000000'), null);
    const admin = await store.activateInvitation(invitation.token, 'strong-passphrase-456', authenticator.generate(details.mfaSecret));
    assert.equal(admin.role, 'Operator');
    assert.equal(await store.getInvitation(invitation.token), null);
    await assert.rejects(store.activateInvitation(invitation.token, 'strong-passphrase-456', authenticator.generate(details.mfaSecret)), /invitation/);
  });
});
