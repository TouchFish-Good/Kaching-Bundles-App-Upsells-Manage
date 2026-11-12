import { env } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';

import { AdminStore } from '../db/admin-store';
import worker from '../index';
import migrationSql from '../migrations/0001_admin_auth.sql?raw';
import nonceMigrationSql from '../migrations/0002_internal_request_nonces.sql?raw';

const context = { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext;
const now = Date.parse('2026-11-12T00:00:00.000Z');
const traceId = '550e8400-e29b-41d4-a716-446655440000';

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://admin.example${path}`, init);
}

async function applyMigration(): Promise<void> {
  await env.ADMIN_DB.exec(`
    DROP TABLE IF EXISTS admin_login_attempts;
    DROP TABLE IF EXISTS internal_request_nonces;
    DROP TABLE IF EXISTS admin_audit;
    DROP TABLE IF EXISTS admin_sessions;
    DROP TABLE IF EXISTS admin_owner_lock;
    DROP TABLE IF EXISTS admin_users;
  `);
  for (const statement of migrationSql.split(';')) {
    const sql = statement.trim();
    if (sql) await env.ADMIN_DB.prepare(sql).run();
  }
  for (const statement of nonceMigrationSql.split(';')) {
    const sql = statement.trim();
    if (sql) await env.ADMIN_DB.prepare(sql).run();
  }
}

async function ownerSession(): Promise<{ cookie: string; csrfToken: string }> {
  const store = new AdminStore(env.ADMIN_DB, () => now);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const login = await worker.fetch(request('/admin-api/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }),
  }), env, context);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  const me = await worker.fetch(request('/admin-api/v1/auth/me', { headers: { Cookie: cookie } }), env, context);
  const body = await me.json() as { data: { csrfToken: string } };
  return { cookie, csrfToken: body.data.csrfToken };
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedCleanupRequest(body: Record<string, unknown>): Promise<Request> {
  const path = '/internal/merchant-redaction/v1/audit-cleanup';
  const timestamp = String(now);
  const nonce = '00000000-0000-4000-8000-000000000001';
  const signature = await hmac(env.ADMIN_INTERNAL_SECRET, `POST\n${path}\n${timestamp}\n${nonce}\n${traceId}`);
  return new Request(`https://admin.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-timestamp': timestamp, 'x-admin-nonce': nonce, 'x-trace-id': traceId, 'x-admin-signature': signature },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await applyMigration();
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';
  env.now = () => now;
});

it('requires an Owner and CSRF token before retrying a failed GDPR task', async () => {
  const unauthenticated = await worker.fetch(request('/admin-api/v1/gdpr/tasks/event-1/retry', { method: 'POST' }), env, context);
  expect(unauthenticated.status).toBe(401);

  const { cookie } = await ownerSession();
  const response = await worker.fetch(request('/admin-api/v1/gdpr/tasks/event-1/retry', { method: 'POST', headers: { Cookie: cookie } }), env, context);
  expect(response.status).toBe(403);
});

it('rejects an unsigned reverse-binding cleanup request without changing admin audit', async () => {
  const store = new AdminStore(env.ADMIN_DB, () => now);
  await store.audit({ action: 'campaign.read', targetId: '42', result: 'success', environment: 'production', requestId: 'audit-1' });

  const response = await worker.fetch(new Request('https://admin.internal/internal/merchant-redaction/v1/audit-cleanup', { method: 'POST' }), env, context);

  expect(response.status).toBe(401);
  await expect(env.ADMIN_DB.prepare('SELECT count(*) AS total FROM admin_audit').first()).resolves.toEqual({ total: 1 });
});

it('deletes only audit records matching a signed merchant cleanup request', async () => {
  const store = new AdminStore(env.ADMIN_DB, () => now);
  await store.audit({ action: 'campaign.read', targetId: '42', result: 'success', environment: 'production', requestId: 'audit-store' });
  await store.audit({ action: 'campaign.read', targetId: 'alpha', result: 'success', environment: 'production', requestId: 'audit-handle' });
  await store.audit({ action: 'campaign.read', targetId: '43', result: 'success', environment: 'production', requestId: 'audit-other' });

  const response = await worker.fetch(await signedCleanupRequest({ storeId: '42', shopHandle: 'alpha' }), env, context);

  expect(response.status).toBe(204);
  await expect(env.ADMIN_DB.prepare('SELECT target_id FROM admin_audit ORDER BY target_id').all()).resolves.toEqual({ success: true, results: [{ target_id: '43' }], meta: expect.anything() });
});

it('projects only safe GDPR task fields and audits a CSRF-protected retry', async () => {
  const fetch = vi.fn(async (internalRequest: Request) => {
    const path = new URL(internalRequest.url).pathname;
    if (path.endsWith('/retry')) return Response.json({ data: {
      webhookId: 'event-1', kind: 'merchant_redact', storeId: '42', handle: 'alpha', customerDigest: null,
      state: 'retrying', receivedAt: now, deadlineAt: now + 1_000, completedAt: null, attempts: 2, nextAttemptAt: now, lastErrorCode: null,
    } });
    return Response.json({ data: { total: 1, offset: 0, items: [{
      webhookId: 'event-1', kind: 'customer_redact', storeId: '42', handle: null, customerDigest: 'digest-only',
      state: 'pending', receivedAt: now, deadlineAt: now + 1_000, completedAt: null, attempts: 0, nextAttemptAt: now, lastErrorCode: null,
      customerId: 'must-not-leak',
    }] } });
  });
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;
  const { cookie, csrfToken } = await ownerSession();

  const invalidSource = await worker.fetch(request('/admin-api/v1/gdpr/customer-tasks?limit=25&offset=0', { headers: { Cookie: cookie } }), env, context);
  expect(invalidSource.status).toBe(503);

  const retried = await worker.fetch(request('/admin-api/v1/gdpr/tasks/event-1/retry', {
    method: 'POST', headers: { Cookie: cookie, 'x-csrf-token': csrfToken },
  }), env, context);
  expect(retried.status).toBe(200);
  const internalRequest = fetch.mock.calls.at(-1)![0] as Request;
  expect(new URL(internalRequest.url).pathname).toBe('/internal/admin/v1/gdpr-tasks/event-1/retry');
  const audit = await new AdminStore(env.ADMIN_DB, () => now).listAudit({});
  expect(audit.items).toContainEqual(expect.objectContaining({ action: 'gdpr.retry_requested', targetId: 'event-1', result: 'success' }));
  expect(audit.items).toContainEqual(expect.objectContaining({ action: 'gdpr.retry_succeeded', targetId: 'event-1', result: 'success' }));
});
