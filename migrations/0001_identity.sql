CREATE TABLE users (
  id TEXT PRIMARY KEY, nickname TEXT NOT NULL, avatar INTEGER NOT NULL,
  friend_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%FT%fZ','now'))
);
CREATE TABLE registration_invites (
  digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_by TEXT REFERENCES users(id)
);
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), public_key TEXT NOT NULL,
  counter INTEGER NOT NULL, transports TEXT NOT NULL, device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE auth_challenges (
  digest TEXT PRIMARY KEY, purpose TEXT NOT NULL, browser TEXT NOT NULL, user_id TEXT,
  context TEXT, expires_at INTEGER NOT NULL, consumed_by TEXT
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE recovery_codes (
  digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), used_by TEXT
);
CREATE INDEX recovery_user ON recovery_codes(user_id);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL, verified_at INTEGER NOT NULL, recovery_digest TEXT, revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_attempts (
  scope TEXT NOT NULL, window INTEGER NOT NULL, attempts INTEGER NOT NULL,
  PRIMARY KEY (scope, window)
);
CREATE INDEX auth_attempts_window ON auth_attempts(window);
