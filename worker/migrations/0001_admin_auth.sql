CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_record TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'Owner'),
  status TEXT NOT NULL CHECK (status = 'active'),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_owner_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL UNIQUE,
  FOREIGN KEY (user_id) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  result TEXT NOT NULL,
  environment TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_occurred_at ON admin_audit(occurred_at DESC);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 0),
  window_ends_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_window_ends_at ON admin_login_attempts(window_ends_at);
