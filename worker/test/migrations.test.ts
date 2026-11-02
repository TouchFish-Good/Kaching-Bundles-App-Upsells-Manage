import { expect, it } from 'vitest';
import sql from '../migrations/0001_admin_auth.sql?raw';

it('creates isolated owner, session, audit, and rate-limit tables', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_users');
  expect(sql).toContain("CHECK (role = 'Owner')");
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_owner_lock');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_login_attempts');
});
