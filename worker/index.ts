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
worker.route('/admin-api/v1', api);

export default worker;
