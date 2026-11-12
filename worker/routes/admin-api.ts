import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { AdminStore } from '../db/admin-store';
import type { Env } from '../env';
import { internalDelete, internalGet, internalPatch, internalPost } from '../internal/merchant-client';
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
  traceId: string;
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

const feedbackStatuses = ['pending', 'approved', 'in_progress', 'released', 'rejected'];
const feedbackDisplays = ['visible', 'rejected_hidden', 'withdrawn'];
const gdprStates = ['pending', 'running', 'completed', 'retrying', 'failed'];

function validId(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9-]{1,128}$/.test(value);
}

function validStoreId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,128}$/.test(value);
}

function validTraceId(value: string | undefined): boolean {
  return value === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validText(value: unknown, maximum: number, required = false): string | undefined | false {
  if (value === undefined || value === null) return required ? false : undefined;
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && Array.from(normalized).length <= maximum ? normalized : false;
}

function csrfAllowed(context: ApiContext): boolean {
  return context.req.header('x-csrf-token') === context.get('owner').csrfToken;
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
    try { result = projectSource(path, await internalGet(context.env, path, context.get('traceId'))); }
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
  app.get('/diagnostics/requests', requireOwner, (context) => {
    const pagination = sourcePage(context);
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    const storeId = context.req.query('storeId');
    const traceId = context.req.query('traceId');
    const method = context.req.query('method');
    const outcome = context.req.query('outcome');
    const httpStatus = context.req.query('httpStatus');
    if ((storeId !== undefined && !validStoreId(storeId)) || !validTraceId(traceId) ||
      (method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) ||
      (outcome !== undefined && !['success', 'client_error', 'server_error'].includes(outcome)) ||
      (httpStatus !== undefined && (!/^\d{3}$/.test(httpStatus) || Number(httpStatus) < 100 || Number(httpStatus) > 599))) {
      return context.json({ error: { code: 'INVALID_FILTER' }, requestId: context.get('requestId') }, 422);
    }
    return source(() => sourcePath('/diagnostics/requests', { storeId, traceId, method, outcome, httpStatus, limit: String(pagination.limit), offset: String(pagination.offset) }), true)(context);
  });
  const campaignRead = (path: (context: ApiContext) => string, targetId: (context: ApiContext) => string | null, action: 'campaign.read' | 'diagnostics.read') => async (context: ApiContext) => {
    const requestId = context.get('requestId');
    const sourcePathname = path(context);
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(sourcePathname, await internalGet(context.env, sourcePathname, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({
        actorId: context.get('owner').id, action, targetId: targetId(context),
        result: result.status === 200 ? 'success' : result.status === 404 ? 'not_found' : 'failure',
        environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId,
      });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 409 | 422 | 503);
  };

  app.get('/campaigns', requireOwner, (context) => {
    const storeId = context.req.query('storeId');
    const pagination = sourcePage(context);
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    if (storeId !== undefined && !validStoreId(storeId)) return context.json({ error: { code: 'INVALID_STORE_ID' }, requestId: context.get('requestId') }, 422);
    const query = context.req.query('query');
    const status = context.req.query('status');
    if (query && query.length > 100) return context.json({ error: { code: 'INVALID_QUERY' }, requestId: context.get('requestId') }, 422);
    if (status && !['draft', 'active', 'expired'].includes(status)) return context.json({ error: { code: 'INVALID_STATUS' }, requestId: context.get('requestId') }, 422);
    const path = storeId
      ? sourcePath(`/stores/${encodeURIComponent(storeId)}/campaigns`, { query, status, limit: String(pagination.limit), offset: String(pagination.offset) })
      : sourcePath('/campaigns', { query, status, limit: String(pagination.limit), offset: String(pagination.offset) });
    return campaignRead(() => path, () => storeId ?? null, 'campaign.read')(context);
  });
  app.get('/campaigns/:id', requireOwner, (context) => {
    const id = context.req.param('id');
    const storeId = context.req.query('storeId');
    if (!validId(id) || !validStoreId(storeId)) return context.json({ error: { code: 'NOT_FOUND' }, requestId: context.get('requestId') }, 404);
    return campaignRead(() => `/stores/${encodeURIComponent(storeId)}/campaigns/${encodeURIComponent(id)}`, () => id, 'campaign.read')(context);
  });
  const gdprTasks = (kind: 'customer_redact' | 'merchant_redact') => async (context: ApiContext) => {
    const pagination = sourcePage(context);
    const state = context.req.query('state');
    const storeId = context.req.query('storeId');
    if (!pagination || (state !== undefined && !gdprStates.includes(state)) || (storeId !== undefined && !validStoreId(storeId))) {
      return context.json({ error: { code: 'INVALID_FILTER' }, requestId: context.get('requestId') }, 422);
    }
    const path = sourcePath('/gdpr-tasks', { kind, state, storeId, limit: String(pagination.limit), offset: String(pagination.offset) });
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await internalGet(context.env, path, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    return context.json({ ...result.body, requestId: context.get('requestId') }, result.status as 200 | 404 | 422 | 503);
  };
  app.get('/gdpr/customer-tasks', requireOwner, gdprTasks('customer_redact'));
  app.get('/gdpr/merchant-tasks', requireOwner, gdprTasks('merchant_redact'));
  app.post('/gdpr/tasks/:webhookId/retry', requireOwner, async (context) => {
    const requestId = context.get('requestId');
    const webhookId = context.req.param('webhookId');
    if (!validId(webhookId)) return context.json({ error: { code: 'NOT_FOUND' }, requestId }, 404);
    if (!csrfAllowed(context)) return context.json({ error: { code: 'CSRF_REQUIRED' }, requestId }, 403);
    const store = new AdminStore(context.env.ADMIN_DB, context.env.now);
    try {
      await store.audit({ actorId: context.get('owner').id, action: 'gdpr.retry_requested', targetId: webhookId, result: 'success', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    const path = `/gdpr-tasks/${encodeURIComponent(webhookId)}/retry`;
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await internalPost(context.env, path, {}, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await store.audit({ actorId: context.get('owner').id, action: result.status === 200 ? 'gdpr.retry_succeeded' : 'gdpr.retry_failed', targetId: webhookId, result: result.status === 200 ? 'success' : 'failure', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 409 | 422 | 503);
  });
  app.get('/diagnostics', requireOwner, (context) => {
    const pagination = sourcePage(context);
    const value = (key: string) => context.req.query(key) || undefined;
    const traceId = value('traceId');
    const storeId = value('storeId');
    const campaignId = value('campaignId');
    const eventType = value('eventType');
    const outcome = value('outcome');
    const from = value('from');
    const to = value('to');
    if (!pagination || !validTraceId(traceId) || (storeId !== undefined && !validStoreId(storeId)) || (campaignId !== undefined && !validId(campaignId)) ||
      (eventType !== undefined && !['shopline_api', 'worker_error', 'campaign_pause', 'campaign_platform_delete', 'campaign_read'].includes(eventType)) ||
      (outcome !== undefined && !['success', 'failure', 'uncertain'].includes(outcome)) ||
      (from !== undefined && Number.isNaN(Date.parse(from))) || (to !== undefined && Number.isNaN(Date.parse(to)))) return context.json({ error: { code: 'INVALID_FILTER' }, requestId: context.get('requestId') }, 422);
    return campaignRead(() => sourcePath('/diagnostics', { traceId, storeId, campaignId, eventType, outcome, from, to, limit: String(pagination.limit), offset: String(pagination.offset) }), () => traceId ?? storeId ?? campaignId ?? null, 'diagnostics.read')(context);
  });
  app.post('/campaigns/:id/pause', requireOwner, async (context) => {
    const requestId = context.get('requestId');
    const id = context.req.param('id');
    if (!validId(id)) return context.json({ error: { code: 'NOT_FOUND' }, requestId }, 404);
    if (!csrfAllowed(context)) return context.json({ error: { code: 'CSRF_REQUIRED' }, requestId }, 403);
    const body = await context.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const storeId = body.storeId;
    const reason = validText(body.reason, 300);
    if (!validStoreId(storeId) || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || reason === false) return context.json({ error: { code: 'INVALID_INPUT' }, requestId }, 422);
    const input = { expectedRevision: body.expectedRevision as number, ...(reason ? { reason } : {}) };
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({ actorId: context.get('owner').id, action: 'campaign.pause_requested', targetId: id, result: 'success', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    const path = `/stores/${encodeURIComponent(storeId)}/campaigns/${encodeURIComponent(id)}/pause`;
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await internalPost(context.env, path, input, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({ actorId: context.get('owner').id, action: result.status === 200 ? 'campaign.pause_succeeded' : 'campaign.pause_failed', targetId: id, result: result.status === 200 ? 'success' : 'failure', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 409 | 422 | 503);
  });
  const campaignPlatformAction = (operation: 'activate' | 'platform-delete', auditAction: 'campaign.activate' | 'campaign.platform_deleted') => async (context: ApiContext) => {
    const requestId = context.get('requestId');
    const id = context.req.param('id');
    if (!validId(id)) return context.json({ error: { code: 'NOT_FOUND' }, requestId }, 404);
    if (!csrfAllowed(context)) return context.json({ error: { code: 'CSRF_REQUIRED' }, requestId }, 403);
    const body = await context.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const storeId = body.storeId;
    const reason = validText(body.reason, 300);
    if (!validStoreId(storeId) || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || reason === false) return context.json({ error: { code: 'INVALID_INPUT' }, requestId }, 422);
    const input = { expectedRevision: body.expectedRevision as number, ...(reason ? { reason } : {}) };
    const path = `/stores/${encodeURIComponent(storeId)}/campaigns/${encodeURIComponent(id)}/${operation}`;
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await internalPost(context.env, path, input, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({ actorId: context.get('owner').id, action: auditAction, targetId: id, result: result.status === 200 ? 'success' : 'failure', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 409 | 422 | 503);
  };
  app.post('/campaigns/:id/activate', requireOwner, campaignPlatformAction('activate', 'campaign.activate'));
  app.post('/campaigns/:id/platform-delete', requireOwner, campaignPlatformAction('platform-delete', 'campaign.platform_deleted'));

  app.get('/feedback', requireOwner, async (context) => {
    const pagination = sourcePage(context);
    const query = context.req.query('query');
    const store = context.req.query('store');
    const status = context.req.query('status');
    const display = context.req.query('display');
    const from = context.req.query('from');
    const to = context.req.query('to');
    const sort = context.req.query('sort') ?? 'newest';
    const replied = context.req.query('replied');
    if (!pagination) return context.json({ error: { code: 'INVALID_PAGINATION' }, requestId: context.get('requestId') }, 422);
    if ((query && query.length > 100) || (store && store.length > 100)) return context.json({ error: { code: 'INVALID_QUERY' }, requestId: context.get('requestId') }, 422);
    if ((status && !feedbackStatuses.includes(status)) || (display && !feedbackDisplays.includes(display)) || !['newest', 'comments', 'votes'].includes(sort) || (replied !== undefined && replied !== '1') || (from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) return context.json({ error: { code: 'INVALID_FILTER' }, requestId: context.get('requestId') }, 422);
    const path = sourcePath('/feedback', { query, store, status, display, from, to, sort, replied, limit: String(pagination.limit), offset: String(pagination.offset) });
    try {
      const result = projectSource(path, await internalGet(context.env, path, context.get('traceId')));
      return context.json({ ...result.body, requestId: context.get('requestId') }, result.status as 200 | 404 | 422 | 503);
    } catch { return context.json({ error: { code: 'SOURCE_UNAVAILABLE' }, requestId: context.get('requestId') }, 503); }
  });

  app.get('/feedback-comments', requireOwner, async (context) => {
    const pagination = sourcePage(context);
    const query = context.req.query('query');
    const store = context.req.query('store');
    const from = context.req.query('from');
    const to = context.req.query('to');
    if (!pagination || (query && query.length > 100) || (store && store.length > 100) || (from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) return context.json({ error: { code: 'INVALID_FILTER' }, requestId: context.get('requestId') }, 422);
    const path = sourcePath('/feedback-comments', { query, store, from, to, limit: String(pagination.limit), offset: String(pagination.offset) });
    try {
      const result = projectSource(path, await internalGet(context.env, path, context.get('traceId')));
      return context.json({ ...result.body, requestId: context.get('requestId') }, result.status as 200 | 404 | 422 | 503);
    } catch { return context.json({ error: { code: 'SOURCE_UNAVAILABLE' }, requestId: context.get('requestId') }, 503); }
  });

  app.get('/feedback/:id', requireOwner, async (context) => {
    const id = context.req.param('id');
    const requestId = context.get('requestId');
    if (!validId(id)) return context.json({ error: { code: 'NOT_FOUND' }, requestId }, 404);
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(`/feedback/${id}`, await internalGet(context.env, `/feedback/${id}`, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({ actorId: context.get('owner').id, action: 'read.sensitive', targetId: id, result: result.status === 200 ? 'success' : result.status === 404 ? 'not_found' : 'failure', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 404 | 422 | 503);
  });

  const feedbackWrite = (action: 'feedback.status_changed' | 'feedback.reply_created' | 'feedback.comment_deleted', request: (env: Env, id: string, body: Record<string, unknown>, commentId: string | undefined, traceId: string) => Promise<{ status: number; body: unknown }>, makePath: (id: string, commentId?: string) => string, validate: (body: Record<string, unknown>) => Record<string, unknown> | null) => async (context: ApiContext) => {
    const id = context.req.param('id');
    const commentId = context.req.param('commentId');
    const requestId = context.get('requestId');
    if (!validId(id) || (commentId !== undefined && !validId(commentId))) return context.json({ error: { code: 'NOT_FOUND' }, requestId }, 404);
    if (!csrfAllowed(context)) return context.json({ error: { code: 'CSRF_REQUIRED' }, requestId }, 403);
    const body = await context.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const input = validate(body);
    if (!input) return context.json({ error: { code: 'INVALID_INPUT' }, requestId }, 422);
    const path = makePath(id, commentId);
    let result: { status: number; body: Record<string, unknown> };
    try { result = projectSource(path, await request(context.env, id, input, commentId, context.get('traceId'))); }
    catch { result = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).audit({ actorId: context.get('owner').id, action, targetId: commentId ?? id, result: result.status >= 200 && result.status < 300 ? 'success' : result.status === 404 ? 'not_found' : 'failure', environment: context.env.ADMIN_ENVIRONMENT ?? 'production', requestId });
    } catch { return context.json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId }, 503); }
    return context.json({ ...result.body, requestId }, result.status as 200 | 201 | 404 | 422 | 503);
  };

  app.patch('/feedback/:id/status', requireOwner, feedbackWrite('feedback.status_changed', (env, id, body, _commentId, traceId) => internalPatch(env, `/feedback/${id}/status`, body, traceId), (id) => `/feedback/${id}/status`, (body) => {
    if (typeof body.status !== 'string' || !feedbackStatuses.includes(body.status) || (body.hideFromMerchants !== undefined && typeof body.hideFromMerchants !== 'boolean') || (body.hideFromMerchants === true && body.status !== 'rejected')) return null;
    const note = validText(body.note, 500);
    if (note === false) return null;
    return { status: body.status, ...(body.hideFromMerchants === true ? { hideFromMerchants: true } : {}), ...(note ? { note } : {}) };
  }));
  app.post('/feedback/:id/replies', requireOwner, feedbackWrite('feedback.reply_created', (env, id, body, _commentId, traceId) => internalPost(env, `/feedback/${id}/replies`, body, traceId), (id) => `/feedback/${id}/replies`, (body) => {
    const content = validText(body.content, 5000, true);
    return content ? { content } : null;
  }));
  app.delete('/feedback/:id/comments/:commentId', requireOwner, feedbackWrite('feedback.comment_deleted', (env, id, body, commentId, traceId) => internalDelete(env, `/feedback/${id}/comments/${commentId}`, body, traceId), (id, commentId) => `/feedback/${id}/comments/${commentId}`, (body) => {
    const reason = validText(body.reason, 500);
    return reason === false ? null : reason ? { reason } : {};
  }));
}
