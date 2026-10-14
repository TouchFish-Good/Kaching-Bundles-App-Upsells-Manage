import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticator } from 'otplib';
import { AdminStore } from '../server/store.js';
import { createApp } from '../server/app.js';

test('merchant cookie cannot authenticate and Viewer cannot read errors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-api-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  await store.ready();
  const secret = authenticator.generateSecret();
  await store.createUser({ email: 'viewer@example.com', password: 'strong-passphrase-123', role: 'Viewer', mfaSecret: secret });
  const app = createApp(store, { internalUrl: 'http://127.0.0.1:1', internalSecret: 'long-internal-secret', environment: 'development' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/admin-api/v1`;
  try {
    assert.equal((await fetch(`${base}/stores`, { headers: { Cookie: 'shopline_session=merchant' } })).status, 401);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer@example.com', password: 'strong-passphrase-123' }) });
    assert.equal(login.status, 200);
    const pendingCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/stores`, { headers: { Cookie: pendingCookie } })).status, 401);
    const mfa = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: pendingCookie }, body: JSON.stringify({ code: authenticator.generate(secret) }) });
    assert.equal(mfa.status, 200);
    const sessionCookie = mfa.headers.getSetCookie().find((value) => value.startsWith('admin_session=')).split(';')[0];
    assert.equal((await fetch(`${base}/events/errors`, { headers: { Cookie: sessionCookie } })).status, 403);
    const overview = await fetch(`${base}/overview`, { headers: { Cookie: sessionCookie } });
    assert.equal(overview.status, 503);
    assert.equal((await overview.json()).error.code, 'SOURCE_UNAVAILABLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Owner invitation is CSRF protected and activation is one-time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-invite-api-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  await store.ready();
  const secret = authenticator.generateSecret();
  await store.createUser({ email: 'owner@example.com', password: 'strong-passphrase-123', role: 'Owner', mfaSecret: secret });
  const app = createApp(store, { internalUrl: 'http://127.0.0.1:1', internalSecret: 'long-internal-secret', environment: 'development' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/admin-api/v1`;
  try {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }) });
    const pending = login.headers.getSetCookie().find((value) => value.startsWith('admin_pending=')).split(';')[0];
    const mfa = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: pending }, body: JSON.stringify({ code: authenticator.generate(secret) }) });
    const session = mfa.headers.getSetCookie().find((value) => value.startsWith('admin_session=')).split(';')[0];
    const admin = (await (await fetch(`${base}/auth/me`, { headers: { Cookie: session } })).json()).data;
    const body = JSON.stringify({ email: 'operator@example.com', role: 'Operator' });
    assert.equal((await fetch(`${base}/admin-users/invitations`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: session }, body })).status, 403);
    const invite = await fetch(`${base}/admin-users/invitations`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: session, 'x-csrf-token': admin.csrfToken }, body });
    assert.equal(invite.status, 201);
    const token = (await invite.json()).data.token;
    const details = await fetch(`${base}/auth/invitation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(details.status, 200);
    const secretForInvite = (await details.json()).data.mfaSecret;
    const activated = await fetch(`${base}/auth/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: 'strong-passphrase-456', code: authenticator.generate(secretForInvite) }) });
    assert.equal(activated.status, 201);
    assert.equal((await fetch(`${base}/auth/invitation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
