import express from 'express';
import { randomUUID } from 'node:crypto';
import { internalGet } from './internal-client.js';
import { projectSource } from './source-projection.js';

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function setCookie(res, name, value, maxAge, secure) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/admin-api/v1; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function safePage(req) {
  const limit = Number(req.query.limit || 25);
  const offset = Number(req.query.offset || 0);
  return Number.isInteger(limit) && limit > 0 && limit <= 100 && Number.isInteger(offset) && offset >= 0 && offset <= 100000 ? { limit, offset } : null;
}

export function createApp(store, config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  const router = express.Router();
  const loginAttempts = new Map();
  const secure = config.secureCookies ?? process.env.NODE_ENV === 'production';

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.requestId = randomUUID();
    res.set('X-Request-Id', res.locals.requestId);
    next();
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const key = req.ip || 'unknown';
      const attempt = loginAttempts.get(key) || { count: 0, resetAt: 0 };
      if (attempt.resetAt < Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60000; }
      attempt.count++;
      loginAttempts.set(key, attempt);
      if (attempt.count > 10) { res.status(429).json({ error: { code: 'RATE_LIMITED' }, requestId: res.locals.requestId }); return; }
      const session = await store.beginLogin(req.body?.email, req.body?.password);
      if (!session) { await store.audit({ action: 'login.password', result: 'failure', requestId: res.locals.requestId, environment: config.environment }); res.status(401).json({ error: { code: 'INVALID_CREDENTIALS' }, requestId: res.locals.requestId }); return; }
      setCookie(res, 'admin_session', session.token, 8 * 3600, secure);
      res.json({ data: { authenticated: true }, requestId: res.locals.requestId });
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });

  const requireOwner = async (req, res, next) => {
    try {
      const admin = await store.authenticate(cookie(req, 'admin_session'));
      if (!admin) { res.status(401).json({ error: { code: 'UNAUTHORIZED' }, requestId: res.locals.requestId }); return; }
      res.locals.admin = admin;
      next();
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  };

  const requireCsrf = (req, res, next) => {
    if (req.header('x-csrf-token') !== res.locals.admin.csrfToken) { res.status(403).json({ error: { code: 'CSRF_REQUIRED' }, requestId: res.locals.requestId }); return; }
    next();
  };

  router.get('/auth/me', requireOwner, (req, res) => {
    const { id, email, role, csrfToken } = res.locals.admin;
    res.json({ data: { id, email, role, csrfToken, environment: config.environment }, requestId: res.locals.requestId });
  });
  router.post('/auth/logout', requireOwner, requireCsrf, async (req, res) => {
    await store.logout(cookie(req, 'admin_session'));
    setCookie(res, 'admin_session', '', 0, secure);
    res.json({ data: { loggedOut: true }, requestId: res.locals.requestId });
  });

  const source = (makePath, sensitive = false) => async (req, res) => {
    if (req.query.environment && req.query.environment !== config.environment) { res.status(422).json({ error: { code: 'INVALID_ENVIRONMENT' }, requestId: res.locals.requestId }); return; }
    let response;
    try {
      const path = makePath(req);
      const result = await internalGet(config, path);
      response = projectSource(path, result);
    } catch { response = { status: 503, body: { error: { code: 'SOURCE_UNAVAILABLE' } } }; }
    if (sensitive) {
      try {
        await store.audit({ actorId: res.locals.admin.id, action: 'read.sensitive', targetId: req.params.storeId || null,
          result: response.status === 200 ? 'success' : response.status === 404 ? 'not_found' : 'failure',
          requestId: res.locals.requestId, environment: config.environment });
      } catch { res.status(503).json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId: res.locals.requestId }); return; }
    }
    res.status(response.status).json({ ...response.body, requestId: res.locals.requestId });
  };
  const query = (req, keys) => {
    const params = new URLSearchParams();
    for (const key of keys) if (typeof req.query[key] === 'string') params.set(key, req.query[key]);
    return params.size ? `?${params}` : '';
  };
  const pageGuard = (req, res, next) => {
    if (!safePage(req)) { res.status(422).json({ error: { code: 'INVALID_PAGINATION' }, requestId: res.locals.requestId }); return; }
    next();
  };

  router.get('/overview', requireOwner, source(() => '/overview'));
  router.get('/stores', requireOwner, pageGuard, source((req) => `/stores${query(req, ['query', 'status', 'limit', 'offset'])}`));
  router.get('/stores/:storeId', requireOwner, source((req) => `/stores/${encodeURIComponent(req.params.storeId)}`, true));
  router.get('/stores/:storeId/bundles', requireOwner, pageGuard, source((req) => `/stores/${encodeURIComponent(req.params.storeId)}/bundles${query(req, ['limit', 'offset'])}`));
  router.get('/bundles', requireOwner, source(() => '/bundles'));
  router.get('/events/errors', requireOwner, pageGuard, source((req) => `/events/errors${query(req, ['storeId', 'from', 'to', 'limit', 'offset'])}`, true));
  router.get('/audit-events', requireOwner, pageGuard, async (req, res) => {
    try { res.json({ data: await store.listAudit(safePage(req)), requestId: res.locals.requestId }); }
    catch { res.status(503).json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });
  app.use('/admin-api/v1', router);
  app.use('/admin-api/v1', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: res.locals.requestId || randomUUID() }));
  return app;
}
