import { Hono } from 'hono';
import type { Env } from './env';
import { registerAdminApiRoutes, type ApiVariables } from './routes/admin-api';
import { registerAuthRoutes } from './routes/auth';
import { AdminStore } from './db/admin-store';
import { internalSignature, timingSafeSignatureEqual } from './internal/merchant-client';

const api = new Hono<{ Bindings: Env; Variables: ApiVariables }>();
const traceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestTraceId(request: Request): string {
  const candidate = request.headers.get('x-trace-id')?.trim() ?? '';
  return traceIdPattern.test(candidate) ? candidate : crypto.randomUUID();
}

function validInternalTraceId(value: string): boolean {
  return traceIdPattern.test(value);
}

async function authorizeMerchantRedaction(request: Request, env: Env): Promise<boolean> {
  const timestamp = request.headers.get('x-admin-timestamp') ?? '';
  const nonce = request.headers.get('x-admin-nonce') ?? '';
  const traceId = request.headers.get('x-trace-id') ?? '';
  const received = request.headers.get('x-admin-signature') ?? '';
  const now = env.now?.() ?? Date.now();
  if (!env.ADMIN_INTERNAL_SECRET || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000 ||
    !/^[A-Za-z0-9-]{8,128}$/.test(nonce) || !validInternalTraceId(traceId) || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const url = new URL(request.url);
  const expected = await internalSignature(env.ADMIN_INTERNAL_SECRET, `${request.method}\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${traceId}`);
  if (!timingSafeSignatureEqual(received, expected)) return false;
  return new AdminStore(env.ADMIN_DB, env.now).consumeInternalNonce(nonce);
}

function merchantRedactionInput(value: unknown): { storeId: string; shopHandle?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'storeId' && key !== 'shopHandle') || typeof input.storeId !== 'string' || !/^\d{1,128}$/.test(input.storeId)) return null;
  if (input.shopHandle === undefined) return { storeId: input.storeId };
  if (typeof input.shopHandle !== 'string' || !/^[a-z0-9][a-z0-9-]{0,252}$/i.test(input.shopHandle)) return null;
  return { storeId: input.storeId, shopHandle: input.shopHandle };
}

api.use('*', async (context, next) => {
  const requestId = crypto.randomUUID();
  const traceId = requestTraceId(context.req.raw);
  context.set('requestId', requestId);
  context.set('traceId', traceId);
  context.header('Cache-Control', 'no-store');
  context.header('X-Request-Id', requestId);
  context.header('X-Trace-Id', traceId);
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
worker.post('/internal/merchant-redaction/v1/audit-cleanup', async (context) => {
  if (!(await authorizeMerchantRedaction(context.req.raw, context.env))) return new Response(null, { status: 401 });
  const input = merchantRedactionInput(await context.req.json().catch(() => null));
  if (!input) return new Response(null, { status: 422 });
  await new AdminStore(context.env.ADMIN_DB, context.env.now).removeMerchantAuditTargets(input.storeId, input.shopHandle);
  return new Response(null, { status: 204 });
});
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
