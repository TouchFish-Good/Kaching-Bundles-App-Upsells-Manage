import sqlite3 from 'sqlite3';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export class AdminStore {
  constructor(path, encryptionKey = process.env.ADMIN_ENCRYPTION_KEY) {
    this.db = new sqlite3.Database(path);
    this.key = encryptionKey ? Buffer.from(encryptionKey, 'hex') : randomBytes(32);
    if (this.key.length !== 32) throw new Error('ADMIN_ENCRYPTION_KEY must be 32 bytes of hex');
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => this.db.run(sql, params, function (error) { error ? reject(error) : resolve(this); }));
  }
  get(sql, params = []) {
    return new Promise((resolve, reject) => this.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
  }
  all(sql, params = []) {
    return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  }

  async ready() {
    await this.run('PRAGMA foreign_keys = ON');
    await this.run(`CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, status TEXT NOT NULL, mfa_secret TEXT NOT NULL,
      created_at TEXT NOT NULL, disabled_at TEXT
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, state TEXT NOT NULL,
      csrf_token TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, revoked_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES admin_users(id)
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_id TEXT,
      result TEXT NOT NULL, environment TEXT NOT NULL, occurred_at TEXT NOT NULL,
      request_id TEXT NOT NULL
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS admin_invitations (
      token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL,
      mfa_secret TEXT NOT NULL, invited_by TEXT NOT NULL,
      expires_at INTEGER NOT NULL, used_at INTEGER
    )`);
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
  }
  decrypt(value) {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  async createUser({ email, password, role, mfaSecret }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || String(password).length < 12 || !['Owner', 'Operator', 'Viewer'].includes(role) || !mfaSecret) {
      throw new Error('Invalid administrator details');
    }
    const id = randomUUID();
    await this.run('INSERT INTO admin_users(id,email,password_hash,role,status,mfa_secret,created_at) VALUES(?,?,?,?,?,?,?)',
      [id, normalized, await argon2.hash(password, { type: argon2.argon2id }), role, 'active', this.encrypt(mfaSecret), new Date().toISOString()]);
    return { id, email: normalized, role };
  }

  async beginLogin(email, password) {
    const user = await this.get('SELECT * FROM admin_users WHERE email=?', [String(email || '').trim().toLowerCase()]);
    if (!user || user.status !== 'active' || !(await argon2.verify(user.password_hash, String(password || '')))) return null;
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.run('INSERT INTO admin_sessions(token_hash,user_id,state,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)',
      [hashToken(token), user.id, 'pending', now, now, now + 5 * 60000]);
    await this.audit({ actorId: user.id, action: 'login.password', targetId: user.id, result: 'pending' });
    return token;
  }

  async completeLogin(pendingToken, code) {
    const row = await this.get(`SELECT s.*,u.mfa_secret,u.status FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.state='pending'`, [hashToken(String(pendingToken || ''))]);
    if (!row || row.status !== 'active' || row.expires_at < Date.now() || !authenticator.check(String(code || ''), this.decrypt(row.mfa_secret))) return null;
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const now = Date.now();
    await this.run('UPDATE admin_sessions SET token_hash=?,state=?,csrf_token=?,last_seen_at=?,expires_at=? WHERE token_hash=?',
      [hashToken(token), 'active', csrfToken, now, now + 8 * 3600000, hashToken(pendingToken)]);
    await this.audit({ actorId: row.user_id, action: 'login.mfa', targetId: row.user_id, result: 'success' });
    return { token, csrfToken };
  }

  async authenticate(token) {
    if (!token) return null;
    const row = await this.get(`SELECT s.*,u.email,u.role,u.status FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.state='active' AND s.revoked_at IS NULL`, [hashToken(token)]);
    const now = Date.now();
    if (!row || row.status !== 'active' || row.expires_at < now || now - row.last_seen_at > 30 * 60000) return null;
    await this.run('UPDATE admin_sessions SET last_seen_at=? WHERE token_hash=?', [now, hashToken(token)]);
    return { id: row.user_id, email: row.email, role: row.role, csrfToken: row.csrf_token };
  }

  async logout(token) {
    if (token) await this.run('UPDATE admin_sessions SET revoked_at=? WHERE token_hash=?', [Date.now(), hashToken(token)]);
  }

  async disableUser(actorId, targetId) {
    const target = await this.get('SELECT id,role,status FROM admin_users WHERE id=?', [targetId]);
    if (!target) throw new Error('Administrator not found');
    if (target.role === 'Owner' && target.status === 'active') {
      const row = await this.get("SELECT count(*) AS count FROM admin_users WHERE role='Owner' AND status='active'");
      if (row.count <= 1) throw new Error('Cannot disable the last Owner');
    }
    await this.run('BEGIN IMMEDIATE');
    try {
      await this.audit({ actorId, action: 'admin.disable', targetId, result: 'success' });
      await this.run("UPDATE admin_users SET status='disabled',disabled_at=? WHERE id=?", [new Date().toISOString(), targetId]);
      await this.run('UPDATE admin_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [Date.now(), targetId]);
      await this.run('COMMIT');
    } catch (error) { await this.run('ROLLBACK'); throw error; }
  }

  async createInvitation(actorId, email, role) {
    const actor = await this.get('SELECT role,status FROM admin_users WHERE id=?', [actorId]);
    if (!actor || actor.role !== 'Owner' || actor.status !== 'active') throw new Error('Owner access required');
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || !['Owner', 'Operator', 'Viewer'].includes(role)) throw new Error('Invalid invitation');
    if (await this.get('SELECT id FROM admin_users WHERE email=?', [normalized])) throw new Error('Administrator already exists');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 24 * 3600000;
    await this.run('BEGIN IMMEDIATE');
    try {
      await this.audit({ actorId, action: 'admin.invite', targetId: normalized, result: 'success' });
      await this.run('INSERT INTO admin_invitations(token_hash,email,role,mfa_secret,invited_by,expires_at) VALUES(?,?,?,?,?,?)',
        [hashToken(token), normalized, role, this.encrypt(authenticator.generateSecret()), actorId, expiresAt]);
      await this.run('COMMIT');
    } catch (error) { await this.run('ROLLBACK'); throw error; }
    return { token, expiresAt };
  }

  async getInvitation(token) {
    if (!token) return null;
    const row = await this.get('SELECT email,role,mfa_secret,expires_at,used_at FROM admin_invitations WHERE token_hash=?', [hashToken(token)]);
    if (!row || row.used_at || row.expires_at < Date.now()) return null;
    return { email: row.email, role: row.role, mfaSecret: this.decrypt(row.mfa_secret), expiresAt: row.expires_at };
  }

  async activateInvitation(token, password, code) {
    const invitation = await this.getInvitation(token);
    if (!invitation) throw new Error('Invalid invitation');
    if (!authenticator.check(String(code || ''), invitation.mfaSecret)) return null;
    if (String(password || '').length < 12) throw new Error('Password must have at least 12 characters');
    await this.run('BEGIN IMMEDIATE');
    try {
      const admin = await this.createUser({ email: invitation.email, password, role: invitation.role, mfaSecret: invitation.mfaSecret });
      await this.audit({ actorId: admin.id, action: 'admin.activate', targetId: admin.id, result: 'success' });
      await this.run('UPDATE admin_invitations SET used_at=? WHERE token_hash=? AND used_at IS NULL', [Date.now(), hashToken(token)]);
      await this.run('COMMIT');
      return admin;
    } catch (error) { await this.run('ROLLBACK'); throw error; }
  }

  async listUsers() {
    const rows = await this.all('SELECT id,email,role,status,created_at,disabled_at FROM admin_users ORDER BY created_at DESC');
    return { items: rows.map((row) => ({ id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.created_at, disabledAt: row.disabled_at })) };
  }

  async audit({ actorId = null, action, targetId = null, result, requestId = randomUUID(), environment = process.env.ADMIN_ENVIRONMENT || 'development' }) {
    await this.run('INSERT INTO admin_audit(id,actor_id,action,target_id,result,environment,occurred_at,request_id) VALUES(?,?,?,?,?,?,?,?)',
      [randomUUID(), actorId, action, targetId, result, environment, new Date().toISOString(), requestId]);
  }

  async listAudit({ limit = 25, offset = 0 }) {
    const rows = await this.all('SELECT id,actor_id,action,target_id,result,environment,occurred_at,request_id FROM admin_audit ORDER BY occurred_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    return { items: rows.map((row) => ({ id: row.id, actorId: row.actor_id, action: row.action, targetId: row.target_id, result: row.result, environment: row.environment, occurredAt: row.occurred_at, requestId: row.request_id })) };
  }

  close() { return new Promise((resolve, reject) => this.db.close((error) => error ? reject(error) : resolve())); }
}
