import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { AdminStore } from '../server/store.js';
import { createApp } from '../server/app.js';

test('the Owner password login creates an authenticated session and legacy admin routes are unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-owner-api-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  await store.ready();
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const app = createApp(store, { internalUrl: 'http://127.0.0.1:1', internalSecret: 'long-internal-secret', environment: 'development' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/admin-api/v1`;
  try {
    assert.equal((await fetch(`${base}/stores`, { headers: { Cookie: 'shopline_session=merchant' } })).status, 401);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }) });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).data.authenticated, true);
    const sessionCookie = login.headers.getSetCookie().find((value) => value.startsWith('admin_session=')).split(';')[0];
    assert.equal((await fetch(`${base}/auth/me`, { headers: { Cookie: sessionCookie } })).status, 200);
    assert.equal((await fetch(`${base}/overview`, { headers: { Cookie: sessionCookie } })).status, 503);
    assert.equal((await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { Cookie: sessionCookie } })).status, 404);
    assert.equal((await fetch(`${base}/admin-users`, { headers: { Cookie: sessionCookie } })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
