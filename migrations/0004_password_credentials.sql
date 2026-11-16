CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nickname_key TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
DROP TABLE passkeys;
DROP TABLE registration_invites;
DROP TABLE auth_challenges;
