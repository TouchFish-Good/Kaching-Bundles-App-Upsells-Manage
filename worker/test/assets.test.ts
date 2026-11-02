import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import worker from '../index';

const context = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

it('keeps api misses as JSON while falling back to the SPA for browser routes', async () => {
  const assets = {
    fetch: async (request: Request) => new URL(request.url).pathname === '/'
      ? new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html' } })
      : new Response('not found', { status: 404 }),
  } as unknown as Fetcher;
  const workerEnv = { ...env, ASSETS: assets };

  const apiMiss = await worker.fetch(new Request('https://admin.example/admin-api/v1/missing'), workerEnv, context);
  expect(apiMiss.status).toBe(404);
  expect(await apiMiss.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

  const page = await worker.fetch(new Request('https://admin.example/stores'), workerEnv, context);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<div id="root">');
});
