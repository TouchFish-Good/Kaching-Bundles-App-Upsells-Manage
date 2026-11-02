import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { AdminStore } from '../db/admin-store';
import type { Env } from '../env';
import { internalGet } from '../internal/merchant-client';
import { projectSource } from '../source-projection';

export type Owner = {
  id: string;
  email: string;
  role: 'Owner';
  csrfToken: string;
};

export type ApiVariables = {
  owner: Owner;
  requestId: string;
};

export type ApiContext = Context<{ Bindings: Env; Variables: ApiVariables }>;

function sessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;

  const session = cookieHeader.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('admin_session='));
  if (!session) return null;

  try {
    return decodeURIComponent(session.slice('admin_session='.length));
  } catch {
    return null;
  }
}

export const requireOwner: MiddlewareHandler<{ Bindings: Env; Variables: ApiVariables }> = async (context, next) => {
  try {
    const owner = await new AdminStore(context.env.ADMIN_DB, context.env.now).authenticate(sessionToken(context.req.raw));
    if (!owner) return context.json({ error: { code: 'UNAUTHORIZED' }, requestId: context.get('requestId') }, 401);

    context.set('owner', owner);
    await next();
  } catch {
    return context.json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: context.get('requestId') }, 503);
  }
};

function page(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function sourcePage(context: ApiContext): { limit: number; offset: number } | null {
  const limit = page(context.req.query('limit') ?? '25');
  const offset = page(context.req.query('offset') ?? '0');
  return limit && limit <= 100 && offset !== undefined && offset <= 100_000 ? { limit, offset } : null;
}

function sourcePath(path: string, entries: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) if (value) query.set(key, value);
  return query.size ? `${path}?${query}` : path;
}

function environmentAllowed(context: ApiContext): boolean {
  const requested = context.req.query('environment');
  return !requested || requested === (context.env.ADMIN_ENVIRONMENT ?? 'production');
}

export function registerAdminApiRoutes(app: Hono<{ Bindings: Env; Variables: ApiVariables }>): void {
  app.get('/audit-events', requireOwner, async (context) => {
    const limit = page(context.req.query('limit'));
    const offset = page(context.req.query('offset'));
    if ((context.req.query('limit') !== undefined && (limit === undefined || limit === 0)) ||
      (context.req.query('offset') !== undefined && offset === undefined)) {
      return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    }

    try {
      const data = await new AdminStore(context.env.ADMIN_DB, context.env.now).listAudit({ limit, offset });
      return context.json({ data, requestId: context.get('requestId') });
    } catch {
      return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId: context.get('requestId') }, 503);
    }
  });

  const source = (makePath: (context: ApiContext) => string, sensitive = false) => async (context: ApiContext) => {
    const requestId = context.get('requestId');
    if (!environmentAllowed(context)) return context.json({ error: { code: 'INVALID_ENVIRONMENT' }, requestId }, 422);
    const path = makePath(context);
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await internalGet(context.env, path)); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }

    if (sensitive) {
      try {
        await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({
          actorId: context.get('owner').id,
          action: 'read.sensitive',
          targetId: context.req.param('storeId') || null,
          result: result.status === 200 ? 'success' : result.status === 404 ? 'not_found' : 'failure',
          environment: context.env.ADMIN_ENVIRONMENT ?? 'production',
          requestId,
        });
      } catch {
        return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503);
      }
    }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 422 | 503);
  };

  app.get('/overview', requireOwner, source(() => '/overview'));
  app.get('/stores', requireOwner, (context) => {
    const pagination = sourcePage(context);
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    return source(() => sourcePath('/stores', { query: context.req.query('query'), status: context.req.query('status'), limit: String(pagination.limit), offset: String(pagination.offset) }))(context);
  });
  app.get('/stores/:storeId', requireOwner, source((context) => `/stores/${encodeURIComponent(context.req.param('storeId') ?? '')}`, true));
  app.get('/stores/:storeId/bundles', requireOwner, (context) => {
    const pagination = sourcePage(context);
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    return source(() => sourcePath(`/stores/${encodeURIComponent(context.req.param('storeId') ?? '')}/bundles`, { limit: String(pagination.limit), offset: String(pagination.offset) }))(context);
  });
  app.get('/bundles', requireOwner, source(() => '/bundles'));
  app.get('/events/errors', requireOwner, (context) => {
    const pagination = sourcePage(context);
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    return source(() => sourcePath('/events/errors', { storeId: context.req.query('storeId'), from: context.req.query('from'), to: context.req.query('to'), limit: String(pagination.limit), offset: String(pagination.offset) }), true)(context);
  });
}
