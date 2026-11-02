import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
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

function jsonRequest(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  return response.headers.get('Set-Cookie')!.split(';')[0];
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

async function seedOwner(): Promise<void> {
  const store = new AdminStore(env.ADMIN_DB);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
}

async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await worker.fetch(request(path, init), env, context);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  return response;
}

beforeEach(applyMigration);

it('sets a secure session cookie and requires CSRF on logout', async () => {
  await seedOwner();
  const login = await worker.fetch(
    jsonRequest('/admin-api/v1/auth/login', {
      email: 'owner@example.com',
      password: 'strong-passphrase-123',
    }),
    env,
    context,
  );

  expect(login.status).toBe(200);
  expect(login.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(login.headers.get('Set-Cookie')).toContain('Secure');
  expect(login.headers.get('Set-Cookie')).toContain('Path=/admin-api/v1');
  const cookie = sessionCookie(login);
  const logout = await fetchApi('/admin-api/v1/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  expect(logout.status).toBe(403);
});

it('enforces Owner authentication, CSRF logout, and retired-route compatibility', async () => {
  await seedOwner();
  const unauthorized = await fetchApi('/admin-api/v1/stores');
  expect(unauthorized.status).toBe(401);

  const invalidLogin = await fetchApi('/admin-api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'wrong-password' }),
  });
  expect(invalidLogin.status).toBe(401);
  expect(JSON.stringify(await invalidLogin.json())).not.toContain('owner@example.com');

  const login = await fetchApi('/admin-api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'strong-passphrase-123' }),
  });
  const cookie = sessionCookie(login);
  const me = await fetchApi('/admin-api/v1/auth/me', { headers: { Cookie: cookie } });
  expect(me.status).toBe(200);
  const meBody = await me.json() as { data: { csrfToken: string; email: string } };
  expect(meBody.data.email).toBe('owner@example.com');
  expect(JSON.stringify(meBody)).not.toContain('admin_session');

  expect((await fetchApi('/admin-api/v1/auth/mfa/verify', { method: 'POST' })).status).toBe(404);
  expect((await fetchApi('/admin-api/v1/admin-users')).status).toBe(404);

  const logout = await fetchApi('/admin-api/v1/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie, 'x-csrf-token': meBody.data.csrfToken },
  });
  expect(logout.status).toBe(200);
  expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect((await fetchApi('/admin-api/v1/auth/me', { headers: { Cookie: cookie } })).status).toBe(401);
});

it('rejects the eleventh shared login attempt with a generic response', async () => {
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    const response = await fetchApi('/admin-api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.99' },
      body: JSON.stringify({ email: 'unknown@example.com', password: 'wrong-password' }),
    });
    expect(response.status).toBe(attempt <= 10 ? 401 : 429);
  }
});
