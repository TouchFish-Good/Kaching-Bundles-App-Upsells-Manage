import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { AdminStore } from '../db/admin-store';
import type { Env } from '../env';

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

  // These routes are reserved for the Merchant Worker integration in Task 4.
  for (const path of ['/overview', '/stores', '/stores/:storeId', '/stores/:storeId/bundles', '/bundles', '/events/errors']) {
    app.get(path, requireOwner, (context) => context.json({
      error: { code: 'NOT_FOUND' },
      requestId: context.get('requestId'),
    }, 404));
  }
}
