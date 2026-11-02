import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { AdminStore } from '../db/admin-store';
import migrationSql from '../migrations/0001_admin_auth.sql?raw';

let now = 1_780_000_000_000;
const fixedNow = () => now;

beforeEach(async () => {
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
  now = 1_780_000_000_000;
});

it('allows one Owner and persists a revocable session', async () => {
  const store = new AdminStore(env.ADMIN_DB, fixedNow);

  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  await expect(
    store.createOwner({ email: 'other@example.com', password: 'another-passphrase-456' }),
  ).rejects.toThrow('OWNER_EXISTS');

  const session = await store.login({
    email: 'owner@example.com',
    password: 'strong-passphrase-123',
    ipKey: 'ip-a',
    environment: 'staging',
    requestId: 'login-request-1',
  });

  expect(session).not.toBeNull();
  expect(await store.authenticate(session!.token)).toMatchObject({
    email: 'owner@example.com',
    role: 'Owner',
  });
  const storedSession = await env.ADMIN_DB.prepare(
    'SELECT token_hash, csrf_token_hash FROM admin_sessions',
  ).first<{ token_hash: string; csrf_token_hash: string }>();
  expect(storedSession).toBeDefined();
  expect(storedSession!.token_hash).not.toBe(session!.token);
  expect(storedSession!.csrf_token_hash).not.toBe(session!.csrfToken);
  await expect(store.listAudit({ limit: 25, offset: 0 })).resolves.toMatchObject({
    items: [expect.objectContaining({ environment: 'staging', requestId: 'login-request-1' })],
  });

  await store.logout(session!.token);
  await expect(store.authenticate(session!.token)).resolves.toBeNull();
});

it('rejects absolute and idle-expired sessions', async () => {
  const store = new AdminStore(env.ADMIN_DB, fixedNow);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  const absoluteSession = await store.login({
    email: 'owner@example.com',
    password: 'strong-passphrase-123',
    ipKey: 'ip-a',
  });

  now += 8 * 60 * 60 * 1000 + 1;
  await expect(store.authenticate(absoluteSession!.token)).resolves.toBeNull();

  now = 1_780_000_000_000;
  const idleSession = await store.login({
    email: 'owner@example.com',
    password: 'strong-passphrase-123',
    ipKey: 'ip-a',
  });
  now += 30 * 60 * 1000 + 1;
  await expect(store.authenticate(idleSession!.token)).resolves.toBeNull();
});

it('shares the eleventh login attempt limit across AdminStore instances', async () => {
  const firstStore = new AdminStore(env.ADMIN_DB, fixedNow);
  const secondStore = new AdminStore(env.ADMIN_DB, fixedNow);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await expect(firstStore.consumeLoginAttempt('ip-a')).resolves.toMatchObject({ allowed: true });
  }
  await expect(secondStore.consumeLoginAttempt('ip-a')).resolves.toMatchObject({ allowed: false, count: 11 });
});

it('returns persisted audit events and propagates audit write failures', async () => {
  const store = new AdminStore(env.ADMIN_DB, fixedNow);
  await store.audit({
    action: 'stores.read',
    result: 'success',
    environment: 'production',
    requestId: 'request-1',
  });

  await expect(store.listAudit({ limit: 25, offset: 0 })).resolves.toMatchObject({
    items: [expect.objectContaining({ action: 'stores.read', requestId: 'request-1' })],
  });

  const failedStore = new AdminStore(
    { prepare: () => { throw new Error('D1 unavailable'); } } as unknown as D1Database,
    fixedNow,
  );
  await expect(
    failedStore.audit({
      action: 'stores.read',
      result: 'failure',
      environment: 'production',
      requestId: 'request-2',
    }),
  ).rejects.toThrow('D1 unavailable');
});
