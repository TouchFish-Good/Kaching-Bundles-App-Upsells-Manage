CREATE TABLE IF NOT EXISTS internal_request_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_internal_request_nonces_expires_at
  ON internal_request_nonces(expires_at);
