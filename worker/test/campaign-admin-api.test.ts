import { env } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';

import { AdminStore } from '../db/admin-store';
import worker from '../index';
import migrationSql from '../migrations/0001_admin_auth.sql?raw';

const context = { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext;

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://admin.example${path}`, init);
}

async function applyMigration(): Promise<void> {
  await env.ADMIN_DB.exec(`
    DROP TABLE IF EXISTS admin_login_attempts;
    DROP TABLE IF EXISTS admin_audit;
    DROP TABLE IF EXISTS admin_sessions;
    DROP TABLE IF EXISTS admin_owner_lock;
    DROP TABLE IF EXISTS admin_users;
  `);
  for (const statement of migrationSql.split(';')) {
    const sql = statement.trim();
    if (sql) await env.ADMIN_DB.prepare(sql).run();
  }
}

async function ownerSession(): Promise<{ cookie: string; csrfToken: string }> {
  const store = new AdminStore(env.ADMIN_DB);
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

async function loggedInFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { cookie } = await ownerSession();
  return worker.fetch(request(path, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } }), env, context);
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await applyMigration();
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';
});

it('requires CSRF for emergency pause, signs a trace ID, and writes a success audit', async () => {
  const traceId = '550e8400-e29b-41d4-a716-446655440000';
  const fetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({
    data: { campaign: { id: 'campaign-1', name: '秋季多件折扣', status: 'paused', revision: 4, scope: { kind: 'products', productIds: ['product-1'], excludedProductIds: [] }, tiers: [], startsAt: null, endsAt: null, pauseReason: null, updatedAt: '2026-11-03T00:00:00.000Z', accessToken: 'secret' } },
  })));
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;

  const forbidden = await loggedInFetch('/admin-api/v1/campaigns/campaign-1/pause', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeId: '42', expectedRevision: 3 }),
  });
  expect(forbidden.status).toBe(403);

  await applyMigration();
  const { cookie, csrfToken } = await ownerSession();
  const response = await worker.fetch(request('/admin-api/v1/campaigns/campaign-1/pause', {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken, 'x-trace-id': traceId },
    body: JSON.stringify({ storeId: '42', expectedRevision: 3, reason: '紧急排障' }),
  }), env, context);

  expect(response.status).toBe(200);
  expect(response.headers.get('x-trace-id')).toBe(traceId);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
  const internalRequest = fetch.mock.calls.at(-1)![0] as Request;
  expect(new URL(internalRequest.url).pathname).toBe('/internal/admin/v1/stores/42/campaigns/campaign-1/pause');
  expect(internalRequest.headers.get('x-trace-id')).toBe(traceId);
  const audit = await new AdminStore(env.ADMIN_DB).listAudit({});
  expect(audit.items).toContainEqual(expect.objectContaining({ action: 'campaign.pause_succeeded', result: 'success', targetId: 'campaign-1' }));
});

it('maps a malformed merchant campaign response to SOURCE_UNAVAILABLE', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({ data: { accessToken: 'secret', items: [] } })) } as unknown as Fetcher;

  const response = await loggedInFetch('/admin-api/v1/campaigns?storeId=42&limit=25&offset=0');

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: { code: 'SOURCE_UNAVAILABLE' } });
});

it('reads global campaigns without exposing SHOPLINE platform IDs', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({
    data: { total: 1, items: [{ id: 'campaign-1', name: '秋季多件折扣', storeId: '42', shopHandle: 'alpha', status: 'active', platformDiscountState: 'active', revision: 4, scope: { kind: 'products', productIds: ['product-1'], excludedProductIds: [] }, tiers: [], startsAt: null, endsAt: null, pauseReason: null, updatedAt: '2026-11-03T00:00:00.000Z', platformDiscountId: 'secret-platform-id' }] },
  })) } as unknown as Fetcher;

  const response = await loggedInFetch('/admin-api/v1/campaigns?limit=25&offset=0');

  expect(response.status).toBe(200);
  const payload = JSON.stringify(await response.json());
  expect(payload).toContain('platformDiscountState');
  expect(payload).not.toContain('secret-platform-id');
});

it('projects allowlisted SHOPLINE diagnostic responses without upstream secrets', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({
    data: { total: 1, items: [{ id: 'event-1', traceId: '550e8400-e29b-41d4-a716-446655440000', workerName: 'shopline-quantity-breaks', storeId: '42', shopHandle: 'alpha', campaignId: 'campaign-1', eventType: 'campaign_pause', outcome: 'uncertain', upstreamService: 'SHOPLINE', upstreamPath: '/sales/discount_apps/1.json', upstreamStatus: 504, upstreamRequestId: 'shopline-1', errorCode: 'UPSTREAM_OUTCOME_UNCERTAIN', upstreamResponseCode: 'DISCOUNT_UNAVAILABLE', upstreamResponseMessage: 'Discount state is temporarily unavailable.', durationMs: 10, occurredAt: '2026-11-03T00:00:00.000Z', accessToken: 'secret' }] },
  })) } as unknown as Fetcher;

  const response = await loggedInFetch('/admin-api/v1/diagnostics?traceId=550e8400-e29b-41d4-a716-446655440000&limit=25&offset=0');

  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({ data: { items: [expect.objectContaining({ upstreamResponseCode: 'DISCOUNT_UNAVAILABLE', upstreamResponseMessage: 'Discount state is temporarily unavailable.' })] } });
  expect(JSON.stringify(payload)).not.toContain('secret');
});

it('preserves only the safe coverage conflict needed by the Owner UI', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({
    error: { code: 'CAMPAIGN_SCOPE_CONFLICT' },
    conflicts: [{ campaignId: 'campaign-2', campaignName: '冬季活动', scopeKind: 'collections', overlap: { type: 'collections', ids: ['collection-1'], names: ['冬季精选'] }, platformDiscountId: 'secret-platform-id' }],
  }), { status: 409 }) } as unknown as Fetcher;
  const { cookie, csrfToken } = await ownerSession();

  const response = await worker.fetch(request('/admin-api/v1/campaigns/campaign-1/activate', {
    method: 'POST',
    headers: { Cookie: cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ storeId: '42', expectedRevision: 4 }),
  }), env, context);

  expect(response.status).toBe(409);
  const payload = JSON.stringify(await response.json());
  expect(payload).toContain('冬季精选');
  expect(payload).not.toContain('secret-platform-id');
});

it('accepts platform-delete as a distinct diagnostic event filter', async () => {
  const fetch = vi.fn(async (internalRequest: Request) => new Response(JSON.stringify({
    data: { total: 0, items: [] },
  })));
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;

  const response = await loggedInFetch('/admin-api/v1/diagnostics?eventType=campaign_platform_delete&limit=25&offset=0');

  expect(response.status).toBe(200);
  expect(new URL((fetch.mock.calls[0][0] as Request).url).searchParams.get('eventType')).toBe('campaign_platform_delete');
});

it('treats empty diagnostic filter values as absent', async () => {
  const fetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({ data: { total: 0, items: [] } })));
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;

  const response = await loggedInFetch('/admin-api/v1/diagnostics?traceId=&storeId=&campaignId=&outcome=&from=&to=&limit=100&offset=0');

  expect(response.status).toBe(200);
  const forwarded = new URL((fetch.mock.calls[0][0] as Request).url);
  expect(forwarded.searchParams.has('traceId')).toBe(false);
  expect(forwarded.searchParams.has('storeId')).toBe(false);
});
