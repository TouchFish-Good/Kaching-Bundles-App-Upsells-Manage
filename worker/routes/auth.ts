import { Hono, type MiddlewareHandler } from 'hono';
import { AdminStore } from '../db/admin-store';
import type { Env } from '../env';
import { requireOwner, type ApiVariables } from './admin-api';

const encoder = new TextEncoder();

function environment(env: Env): string {
  return env.ADMIN_ENVIRONMENT ?? 'production';
}

function sessionCookie(token: string, maxAge: number): string {
  return `admin_session=${encodeURIComponent(token)}; Path=/admin-api/v1; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function tokenFromCookie(request: Request): string | null {
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

async function ipKey(request: Request): Promise<string> {
  const source = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(source));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

type LoginInput = { email?: unknown; password?: unknown };

export function registerAuthRoutes(app: Hono<{ Bindings: Env; Variables: ApiVariables }>): void {
  app.post('/auth/login', async (context) => {
    const requestId = context.get('requestId');
    try {
      const store = new AdminStore(context.env.ADMIN_DB, context.env.now);
      const attempt = await store.consumeLoginAttempt(await ipKey(context.req.raw));
      if (!attempt.allowed) {
        return context.json({ error: { code: 'RATE_LIMITED' }, requestId }, 429);
      }

      const body = await context.req.json<LoginInput>().catch((): LoginInput => ({}));
      const email = typeof body.email === 'string' ? body.email : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const session = await store.login({
        email,
        password,
        ipKey: await ipKey(context.req.raw),
        environment: environment(context.env),
        requestId,
      });
      if (!session) {
        return context.json({ error: { code: 'INVALID_CREDENTIALS' }, requestId }, 401);
      }

      context.header('Set-Cookie', sessionCookie(session.token, 8 * 60 * 60));
      return context.json({ data: { authenticated: true }, requestId });
    } catch {
      return context.json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId }, 503);
    }
  });

  app.get('/auth/me', requireOwner, (context) => {
    const owner = context.get('owner');
    return context.json({
      data: {
        id: owner.id,
        email: owner.email,
        role: owner.role,
        csrfToken: owner.csrfToken,
        environment: environment(context.env),
      },
      requestId: context.get('requestId'),
    });
  });

  app.post('/auth/logout', requireOwner, async (context) => {
    const requestId = context.get('requestId');
    const owner = context.get('owner');
    if (context.req.header('x-csrf-token') !== owner.csrfToken) {
      return context.json({ error: { code: 'CSRF_REQUIRED' }, requestId }, 403);
    }

    try {
      await new AdminStore(context.env.ADMIN_DB, context.env.now).logout(tokenFromCookie(context.req.raw));
      context.header('Set-Cookie', sessionCookie('', 0));
      return context.json({ data: { loggedOut: true }, requestId });
    } catch {
      return context.json({ error: { code: 'AUTH_UNAVAILABLE' }, requestId }, 503);
    }
  });
}
