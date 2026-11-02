import { createPasswordRecord, verifyPasswordRecord } from '../../shared/password-record.mjs';

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;

type Clock = () => number;

type OwnerInput = {
  email: string;
  password: string;
};

type LoginInput = OwnerInput & {
  ipKey: string;
  environment?: string;
  requestId?: string;
};

type AuditInput = {
  actorId?: string | null;
  action: string;
  targetId?: string | null;
  result: string;
  environment: string;
  requestId: string;
};

type AuditPage = {
  limit?: number;
  offset?: number;
};

type SessionRow = {
  user_id: string;
  csrf_token_hash: string;
  last_seen_at: number;
  expires_at: number;
  email: string;
  role: string;
  status: string;
};

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomToken(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function csrfForSession(token: string): Promise<string> {
  return sha256(`csrf:${token}`);
}

function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

function invalidOwnerInput(email: string, password: string): boolean {
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12;
}

export class AdminStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: Clock = () => Date.now(),
  ) {}

  async createOwner(input: OwnerInput): Promise<{ id: string; email: string; role: 'Owner' }> {
    const email = normalizeEmail(input.email);
    const password = String(input.password);
    if (invalidOwnerInput(email, password)) throw new Error('INVALID_OWNER');

    const id = crypto.randomUUID();
    const passwordRecord = await createPasswordRecord(password);

    try {
      await this.db.batch([
        this.db.prepare(
          'INSERT INTO admin_users(id, email, password_record, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(id, email, passwordRecord, 'Owner', 'active', this.now()),
        this.db.prepare('INSERT INTO admin_owner_lock(id, user_id) VALUES (?, ?)').bind(1, id),
      ]);
    } catch (error) {
      if (/constraint|unique/i.test(error instanceof Error ? error.message : String(error))) {
        throw new Error('OWNER_EXISTS');
      }
      throw error;
    }

    return { id, email, role: 'Owner' };
  }

  async login(input: LoginInput): Promise<{ token: string; csrfToken: string } | null> {
    const email = normalizeEmail(input.email);
    const password = String(input.password);
    const user = await this.db.prepare(
      "SELECT id, email, password_record, role, status FROM admin_users WHERE email = ? AND role = 'Owner' AND status = 'active'",
    ).bind(email).first<{ id: string; email: string; password_record: string; role: string; status: string }>();

    if (!user || !(await verifyPasswordRecord(user.password_record, password))) return null;

    const token = randomToken(32);
    const csrfToken = await csrfForSession(token);
    const now = this.now();
    await this.db.prepare(
      'INSERT INTO admin_sessions(token_hash, user_id, csrf_token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(await sha256(token), user.id, await sha256(csrfToken), now, now, now + SESSION_LIFETIME_MS).run();

    await this.audit({
      actorId: user.id,
      action: 'login.password',
      targetId: user.id,
      result: 'success',
      environment: input.environment ?? 'production',
      requestId: input.requestId ?? crypto.randomUUID(),
    });

    return { token, csrfToken };
  }

  async authenticate(token: string | null | undefined): Promise<{ id: string; email: string; role: 'Owner'; csrfToken: string } | null> {
    if (!token) return null;

    const tokenHash = await sha256(token);
    const row = await this.db.prepare(
      "SELECT s.user_id, s.csrf_token_hash, s.last_seen_at, s.expires_at, u.email, u.role, u.status FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL",
    ).bind(tokenHash).first<SessionRow>();
    const now = this.now();
    if (!row || row.status !== 'active' || row.role !== 'Owner' || row.expires_at <= now || now - row.last_seen_at > SESSION_IDLE_MS) {
      return null;
    }

    const csrfToken = await csrfForSession(token);
    if (row.csrf_token_hash !== await sha256(csrfToken)) return null;

    await this.db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
    return { id: row.user_id, email: row.email, role: 'Owner', csrfToken };
  }

  async logout(token: string | null | undefined): Promise<void> {
    if (!token) return;
    await this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(this.now(), await sha256(token))
      .run();
  }

  async audit(input: AuditInput): Promise<void> {
    await this.db.prepare(
      'INSERT INTO admin_audit(id, actor_id, action, target_id, result, environment, occurred_at, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      input.actorId ?? null,
      input.action,
      input.targetId ?? null,
      input.result,
      input.environment,
      this.now(),
      input.requestId,
    ).run();
  }

  async listAudit(page: AuditPage): Promise<{ items: Array<Record<string, string | number | null>> }> {
    const limit = Math.min(Math.max(page.limit ?? 25, 1), 100);
    const offset = Math.max(page.offset ?? 0, 0);
    const result = await this.db.prepare(
      'SELECT id, actor_id, action, target_id, result, environment, occurred_at, request_id FROM admin_audit ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?',
    ).bind(limit, offset).all<Record<string, string | number | null>>();

    return {
      items: result.results.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        action: row.action,
        targetId: row.target_id,
        result: row.result,
        environment: row.environment,
        occurredAt: row.occurred_at,
        requestId: row.request_id,
      })),
    };
  }

  async consumeLoginAttempt(ipKey: string): Promise<{ allowed: boolean; count: number; windowEndsAt: number }> {
    const now = this.now();
    const windowEndsAt = now + LOGIN_WINDOW_MS;
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM admin_login_attempts WHERE window_ends_at <= ?').bind(now),
      this.db.prepare(
        'INSERT INTO admin_login_attempts(ip_key, count, window_ends_at) VALUES (?, 1, ?) ON CONFLICT(ip_key) DO UPDATE SET count = admin_login_attempts.count + 1 RETURNING count, window_ends_at',
      ).bind(ipKey, windowEndsAt),
    ]);
    const row = results[1].results[0] as { count: number; window_ends_at: number } | undefined;
    if (!row) throw new Error('LOGIN_ATTEMPT_UNAVAILABLE');

    return { allowed: row.count <= LOGIN_ATTEMPT_LIMIT, count: row.count, windowEndsAt: row.window_ends_at };
  }
}
