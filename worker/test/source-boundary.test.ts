import { env } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
import worker from '../index';
import { AdminStore } from '../db/admin-store';
import migrationSql from '../migrations/0001_admin_auth.sql?raw';

const context = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

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

async function loggedInFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const store = new AdminStore(env.ADMIN_DB);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const login = await worker.fetch(request('/admin-api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }),
  }), env, context);
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  return worker.fetch(request(path, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } }), env, context);
}

async function ownerCookie(): Promise<string> {
  const store = new AdminStore(env.ADMIN_DB);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const login = await worker.fetch(request('/admin-api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }),
  }), env, context);
  return login.headers.get('Set-Cookie')!.split(';')[0];
}

async function ownerSession(): Promise<{ cookie: string; csrfToken: string }> {
  const cookie = await ownerCookie();
  const response = await worker.fetch(request('/admin-api/v1/auth/me', { headers: { Cookie: cookie } }), env, context);
  const body = await response.json() as { data: { csrfToken: string } };
  return { cookie, csrfToken: body.data.csrfToken };
}

beforeEach(applyMigration);

it('signs Service Binding paths and strips fields not in the source contract', async () => {
  const fetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({
    data: {
      total: 1,
      accessToken: 'never-return-this',
      items: [{
        storeId: 'store-42',
        handle: 'shop',
        scope: '',
        status: 'installed',
        installedAt: '2026-10-14T01:00:00Z',
        updatedAt: '2026-10-14T02:00:00Z',
        accessToken: 'never-return-this',
      }],
    },
  })));
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';

  const response = await loggedInFetch('/admin-api/v1/stores?limit=25');

  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain('never-return-this');
  const internalRequest = fetch.mock.calls[0][0] as Request;
  expect(new URL(internalRequest.url).pathname).toBe('/internal/admin-read/v1/stores');
  expect(internalRequest.headers.get('x-admin-timestamp')).toMatch(/^\d{13}$/);
  expect(internalRequest.headers.get('x-admin-nonce')).toMatch(/^[0-9a-f-]{36}$/);
  expect(internalRequest.headers.get('x-admin-signature')).toMatch(/^[a-f0-9]{64}$/);
});

it('maps merchant 404 responses and audits the sensitive read as not found', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 }) } as unknown as Fetcher;
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';

  const response = await loggedInFetch('/admin-api/v1/stores/store-missing');

  expect(response.status).toBe(404);
  const audit = await new AdminStore(env.ADMIN_DB).listAudit({});
  expect(audit.items).toContainEqual(expect.objectContaining({
    action: 'read.sensitive',
    result: 'not_found',
    targetId: 'store-missing',
  }));
});

it('maps malformed and replay-rejected merchant responses to source unavailable', async () => {
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';
  env.MERCHANT_APP = { fetch: async () => new Response('<html>unexpected</html>') } as unknown as Fetcher;
  expect((await loggedInFetch('/admin-api/v1/stores')).status).toBe(503);

  await applyMigration();
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }) } as unknown as Fetcher;
  expect((await loggedInFetch('/admin-api/v1/stores')).status).toBe(503);
});

it('blocks sensitive responses when their audit write fails', async () => {
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({
    data: { storeId: 'store-42', handle: 'shop', scope: '', status: 'installed', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T02:00:00Z', installations: [] },
  })) } as unknown as Fetcher;
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';
  const cookie = await ownerCookie();
  const failedAuditDb = new Proxy(env.ADMIN_DB, {
    get(target, property, receiver) {
      if (property === 'prepare') return (sql: string) => {
        if (sql.startsWith('INSERT INTO admin_audit')) throw new Error('audit unavailable');
        return target.prepare(sql);
      };
      return Reflect.get(target, property, receiver);
    },
  });

  const response = await worker.fetch(request('/admin-api/v1/stores/store-42', { headers: { Cookie: cookie } }), {
    ...env,
    ADMIN_DB: failedAuditDb,
  }, context);

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } });
});

it('signs a feedback status change, requires CSRF, and audits the Owner action', async () => {
  const fetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({
    data: {
      feedback: {
        id: 'request-1', status: 'approved', authorLabel: '商家', isMine: false, title: '标题', content: '内容', voteCount: 0,
        commentCount: 0, voted: false, createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z', canWithdraw: false, comments: [], replies: [],
      },
    },
  })));
  env.MERCHANT_APP = { fetch } as unknown as Fetcher;
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';

  const forbidden = await loggedInFetch('/admin-api/v1/feedback/request-1/status', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  });
  expect(forbidden.status).toBe(403);

  await applyMigration();
  const { cookie, csrfToken } = await ownerSession();
  const success = await worker.fetch(request('/admin-api/v1/feedback/request-1/status', {
    method: 'PATCH',
    headers: { Cookie: cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ status: 'approved' }),
  }), env, context);

  expect(success.status).toBe(200);
  const internalRequest = fetch.mock.calls.at(-1)![0] as Request;
  expect(internalRequest.method).toBe('PATCH');
  expect(new URL(internalRequest.url).pathname).toBe('/internal/admin/v1/feedback/request-1/status');
  expect(await internalRequest.json()).toEqual({ status: 'approved' });
  const audit = await new AdminStore(env.ADMIN_DB).listAudit({});
  expect(audit.items).toContainEqual(expect.objectContaining({ action: 'feedback.status_changed', result: 'success', targetId: 'request-1' }));
});

it('projects only approved Owner feedback fields and maps merchant failures to SOURCE_UNAVAILABLE', async () => {
  env.ADMIN_INTERNAL_SECRET = 'test-admin-internal-secret';
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({ data: { accessToken: 'secret', items: [] } })) } as unknown as Fetcher;

  const invalid = await loggedInFetch('/admin-api/v1/feedback?limit=25&offset=0');
  expect(invalid.status).toBe(503);

  await applyMigration();
  env.MERCHANT_APP = { fetch: async () => new Response(JSON.stringify({
    data: {
      total: 1,
      offset: 0,
      items: [{
        id: 'request-1', storeId: 'store-1', handle: 'alpha', isAnonymous: true, title: '标题', excerpt: '内容摘要',
        status: 'pending', displayStatus: 'pending', hiddenReason: null, voteCount: 0, commentCount: 0,
        createdAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T01:00:00Z', hasOfficialReply: false, accessToken: 'secret',
      }],
    },
  })) } as unknown as Fetcher;
  const response = await loggedInFetch('/admin-api/v1/feedback?limit=25&offset=0');
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain('secret');
});
