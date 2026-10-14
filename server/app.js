import express from 'express';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { internalGet } from './internal-client.js';

const roleRank = { Viewer: 1, Operator: 2, Owner: 3 };

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
      const token = await store.beginLogin(req.body?.email, req.body?.password);
      if (!token) { await store.audit({ action: 'login.password', result: 'failure', requestId: res.locals.requestId, environment: config.environment }); res.status(401).json({ error: { code: 'INVALID_CREDENTIALS' }, requestId: res.locals.requestId }); return; }
      setCookie(res, 'admin_pending', token, 300, secure);
      res.json({ data: { mfaRequired: true }, requestId: res.locals.requestId });
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });

  router.post('/auth/mfa/verify', async (req, res) => {
    try {
      const pending = cookie(req, 'admin_pending');
      const session = await store.completeLogin(pending, req.body?.code);
      if (!session) { await store.audit({ action: 'login.mfa', result: 'failure', requestId: res.locals.requestId, environment: config.environment }); res.status(401).json({ error: { code: 'INVALID_MFA' }, requestId: res.locals.requestId }); return; }
      setCookie(res, 'admin_pending', '', 0, secure);
      setCookie(res, 'admin_session', session.token, 8 * 3600, secure);
      res.json({ data: { authenticated: true }, requestId: res.locals.requestId });
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });

  router.post('/auth/invitation', async (req, res) => {
    try {
      const invitation = await store.getInvitation(req.body?.token);
      if (!invitation) { res.status(404).json({ error: { code: 'INVITATION_NOT_FOUND' }, requestId: res.locals.requestId }); return; }
      res.json({ data: { ...invitation, otpauthUrl: authenticator.keyuri(invitation.email, 'Kaching Developer Admin', invitation.mfaSecret) }, requestId: res.locals.requestId });
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });

  router.post('/auth/activate', async (req, res) => {
    try {
      const user = await store.activateInvitation(req.body?.token, req.body?.password, req.body?.code);
      if (!user) { res.status(422).json({ error: { code: 'INVALID_MFA' }, requestId: res.locals.requestId }); return; }
      res.status(201).json({ data: { email: user.email, role: user.role }, requestId: res.locals.requestId });
    } catch (error) {
      const code = error instanceof Error && /invitation/i.test(error.message) ? 'INVITATION_NOT_FOUND' : 'ACTIVATION_FAILED';
      res.status(code === 'INVITATION_NOT_FOUND' ? 404 : 422).json({ error: { code }, requestId: res.locals.requestId });
    }
  });

  const requireAdmin = (role) => async (req, res, next) => {
    try {
      const admin = await store.authenticate(cookie(req, 'admin_session'));
      if (!admin) { res.status(401).json({ error: { code: 'UNAUTHORIZED' }, requestId: res.locals.requestId }); return; }
      if (roleRank[admin.role] < roleRank[role]) { res.status(403).json({ error: { code: 'FORBIDDEN' }, requestId: res.locals.requestId }); return; }
      res.locals.admin = admin;
      next();
    } catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  };

  const requireCsrf = (req, res, next) => {
    if (req.header('x-csrf-token') !== res.locals.admin.csrfToken) { res.status(403).json({ error: { code: 'CSRF_REQUIRED' }, requestId: res.locals.requestId }); return; }
    next();
  };

  router.get('/auth/me', requireAdmin('Viewer'), (req, res) => {
    const { id, email, role, csrfToken } = res.locals.admin;
    res.json({ data: { id, email, role, csrfToken, environment: config.environment }, requestId: res.locals.requestId });
  });
  router.post('/auth/logout', requireAdmin('Viewer'), requireCsrf, async (req, res) => {
    await store.logout(cookie(req, 'admin_session'));
    setCookie(res, 'admin_session', '', 0, secure);
    res.json({ data: { loggedOut: true }, requestId: res.locals.requestId });
  });

  const source = (makePath, sensitive = false) => async (req, res) => {
    if (req.query.environment && req.query.environment !== config.environment) { res.status(422).json({ error: { code: 'INVALID_ENVIRONMENT' }, requestId: res.locals.requestId }); return; }
    try {
      const path = makePath(req);
      if (sensitive) await store.audit({ actorId: res.locals.admin.id, action: 'read.sensitive', targetId: req.params.storeId || null, result: 'success', requestId: res.locals.requestId, environment: config.environment });
      const result = await internalGet(config, path);
      res.status(result.status).json({ ...result.body, requestId: res.locals.requestId });
    } catch { res.status(503).json({ error: { code: 'SOURCE_UNAVAILABLE' }, requestId: res.locals.requestId }); }
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

  router.get('/overview', requireAdmin('Viewer'), source(() => '/overview'));
  router.get('/stores', requireAdmin('Viewer'), pageGuard, source((req) => `/stores${query(req, ['query', 'status', 'limit', 'offset'])}`));
  router.get('/stores/:storeId', requireAdmin('Viewer'), source((req) => `/stores/${encodeURIComponent(req.params.storeId)}`, true));
  router.get('/stores/:storeId/bundles', requireAdmin('Viewer'), pageGuard, source((req) => `/stores/${encodeURIComponent(req.params.storeId)}/bundles${query(req, ['limit', 'offset'])}`));
  router.get('/bundles', requireAdmin('Viewer'), source(() => '/bundles'));
  router.get('/events/errors', requireAdmin('Operator'), pageGuard, source((req) => `/events/errors${query(req, ['storeId', 'from', 'to', 'limit', 'offset'])}`, true));
  router.get('/audit-events', requireAdmin('Owner'), pageGuard, async (req, res) => {
    try { res.json({ data: await store.listAudit(safePage(req)), requestId: res.locals.requestId }); }
    catch { res.status(503).json({ error: { code: 'AUDIT_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });
  router.get('/admin-users', requireAdmin('Owner'), async (_req, res) => {
    try { res.json({ data: await store.listUsers(), requestId: res.locals.requestId }); }
    catch { res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId: res.locals.requestId }); }
  });
  router.post('/admin-users/invitations', requireAdmin('Owner'), requireCsrf, async (req, res) => {
    try {
      const invitation = await store.createInvitation(res.locals.admin.id, req.body?.email, req.body?.role);
      res.status(201).json({ data: invitation, requestId: res.locals.requestId });
    } catch { res.status(422).json({ error: { code: 'INVITATION_FAILED' }, requestId: res.locals.requestId }); }
  });
  router.post('/admin-users/:id/disable', requireAdmin('Owner'), requireCsrf, async (req, res) => {
    try {
      await store.disableUser(res.locals.admin.id, req.params.id);
      res.json({ data: { disabled: true }, requestId: res.locals.requestId });
    } catch (error) {
      const code = error instanceof Error && /last Owner/.test(error.message) ? 'LAST_OWNER' : 'ADMIN_CHANGE_FAILED';
      res.status(409).json({ error: { code }, requestId: res.locals.requestId });
    }
  });

  app.use('/admin-api/v1', router);
  app.use('/admin-api/v1', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND' }, requestId: res.locals.requestId || randomUUID() }));
  return app;
}
