import { Hono } from 'hono';
import type { Env } from './env';
import { registerAdminApiRoutes, type ApiVariables } from './routes/admin-api';
import { registerAuthRoutes } from './routes/auth';

const api = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

api.use('*', async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set('requestId', requestId);
  context.header('Cache-Control', 'no-store');
  context.header('X-Request-Id', requestId);
  await next();
});

registerAuthRoutes(api);
registerAdminApiRoutes(api);

api.notFound((context) => context.json({
  error: { code: 'NOT_FOUND' },
  requestId: context.get('requestId'),
}, 404));

api.onError((_error, context) => context.json({
  error: { code: 'AUTH_UNAVAILABLE' },
  requestId: context.get('requestId'),
}, 503));

const worker = new Hono<{ Bindings: Env }>();
worker.all('/admin-api/v1/*', (context) => {
  const url = new URL(context.req.url);
  url.pathname = url.pathname.slice('/admin-api/v1'.length) || '/';
  return api.fetch(new Request(url, context.req.raw), context.env, context.executionCtx);
});
worker.get('*', async (context) => {
  const asset = await context.env.ASSETS.fetch(context.req.raw);
  if (asset.status !== 404) return asset;
  return context.env.ASSETS.fetch(new Request(new URL('/', context.req.url)));
});

export default worker;
