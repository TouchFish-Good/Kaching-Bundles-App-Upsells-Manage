import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('provides the isolated Admin D1 binding to Worker tests', () => {
  expect(env.ADMIN_DB).toBeDefined();
});
