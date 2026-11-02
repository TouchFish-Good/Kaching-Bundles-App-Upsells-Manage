import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { AdminStore } from '../server/store.js';
import { createApp } from '../server/app.js';

test('source data is projected and sensitive reads audit the actual result', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaching-source-boundary-'));
  const store = new AdminStore(join(dir, 'admin.sqlite'));
  await store.ready();
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const source = express();
  source.get('/internal/admin-read/v1/stores', (req, res) => res.json({ data: { total: 1, items: [{ storeId: 'store-42', handle: 'shop', status: 'installed', scope: req.query.query === 'bad' ? { accessToken: 'secret' } : '', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T02:00:00Z', accessToken: 'secret' }], accessToken: 'secret' } }));
  source.get('/internal/admin-read/v1/stores/store-42', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', accessToken: 'secret' }, accessToken: 'secret' }));
  source.get('/internal/admin-read/v1/stores/store-43', (_req, res) => res.json({ data: { storeId: 'store-43', handle: 'other-shop', scope: '', status: 'installed', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T02:00:00Z', installations: [], accessToken: 'secret' } }));
  const sourceServer = source.listen(0, '127.0.0.1');
  await once(sourceServer, 'listening');
  const app = createApp(store, { internalUrl: `http://127.0.0.1:${sourceServer.address().port}`, internalSecret: 'test-secret', environment: 'development' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/admin-api/v1`;
  try {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }) });
    const session = login.headers.getSetCookie().find((value) => value.startsWith('admin_session=')).split(';')[0];
    const stores = await (await fetch(`${base}/stores`, { headers: { Cookie: session } })).json();
    assert.equal(stores.data.items[0].storeId, 'store-42');
    assert.equal(JSON.stringify(stores).includes('accessToken'), false);
    const malformed = await fetch(`${base}/stores?query=bad`, { headers: { Cookie: session } });
    assert.equal(malformed.status, 503);
    assert.equal(JSON.stringify(await malformed.json()).includes('accessToken'), false);
    const detailResponse = await fetch(`${base}/stores/store-42`, { headers: { Cookie: session } });
    assert.equal(detailResponse.status, 404);
    assert.deepEqual((await detailResponse.json()).error, { code: 'NOT_FOUND' });
    const audit = await store.listAudit({ limit: 25, offset: 0 });
    const read = audit.items.find((event) => event.action === 'read.sensitive');
    assert.equal(read.result, 'not_found');
    assert.equal(read.targetId, 'store-42');
    store.audit = async () => { throw new Error('audit unavailable'); };
    const blocked = await fetch(`${base}/stores/store-43`, { headers: { Cookie: session } });
    assert.equal(blocked.status, 503);
    assert.deepEqual((await blocked.json()).error, { code: 'AUDIT_UNAVAILABLE' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => sourceServer.close(resolve));
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
