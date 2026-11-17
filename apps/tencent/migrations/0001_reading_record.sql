CREATE SCHEMA reading_record;
REVOKE ALL ON SCHEMA reading_record FROM PUBLIC;
SET LOCAL search_path = reading_record, pg_catalog;

CREATE FUNCTION utc_timestamp_text() RETURNS text
LANGUAGE sql VOLATILE
AS $$ SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

CREATE FUNCTION business_date() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT to_char(statement_timestamp() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') $$;

CREATE TABLE users (
  id text PRIMARY KEY,
  nickname text NOT NULL,
  avatar integer NOT NULL,
  friend_code text NOT NULL UNIQUE,
  created_at text NOT NULL DEFAULT utc_timestamp_text()
);

CREATE TABLE password_credentials (
  user_id text PRIMARY KEY REFERENCES users(id),
  nickname_key text NOT NULL CONSTRAINT "password_credentials.nickname_key" UNIQUE,
  salt text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE sessions (
  digest text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  purpose text NOT NULL,
  expires_at bigint NOT NULL,
  verified_at bigint NOT NULL,
  revoked_at bigint
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE auth_attempts (
  scope text NOT NULL,
  "window" bigint NOT NULL,
  attempts integer NOT NULL,
  PRIMARY KEY (scope, "window")
);
CREATE INDEX auth_attempts_window ON auth_attempts("window");

CREATE TABLE books (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  total_pages integer NOT NULL CHECK (total_pages BETWEEN 1 AND 1000000),
  revision integer NOT NULL DEFAULT 0,
  current_page integer NOT NULL DEFAULT 0,
  completed_on text,
  created_at text NOT NULL DEFAULT utc_timestamp_text(),
  deleted_at text,
  request_id text NOT NULL,
  input_digest text NOT NULL,
  initial_page integer NOT NULL DEFAULT 0 CHECK (initial_page BETWEEN 0 AND total_pages),
  UNIQUE (owner_id, request_id)
);
CREATE INDEX books_owner ON books(owner_id, deleted_at, created_at);

CREATE TABLE check_ins (
  id text PRIMARY KEY,
  book_id text NOT NULL REFERENCES books(id),
  reading_date text NOT NULL,
  page integer NOT NULL,
  recorded_at text NOT NULL DEFAULT utc_timestamp_text(),
  expected_revision integer NOT NULL,
  sequence integer NOT NULL,
  request_id text NOT NULL,
  input_digest text NOT NULL,
  UNIQUE (book_id, request_id),
  UNIQUE (book_id, sequence)
);

CREATE TABLE daily_progress (
  book_id text NOT NULL REFERENCES books(id),
  reading_date text NOT NULL,
  effective_check_in_id text NOT NULL REFERENCES check_ins(id),
  PRIMARY KEY (book_id, reading_date)
);

CREATE TABLE friendships (
  id text PRIMARY KEY,
  first_id text NOT NULL REFERENCES users(id),
  second_id text NOT NULL REFERENCES users(id),
  created_at text NOT NULL DEFAULT utc_timestamp_text(),
  ended_at text,
  CHECK (first_id <> second_id)
);

CREATE TABLE active_friendship_members (
  user_id text CONSTRAINT "active_friendship_members.user_id" PRIMARY KEY REFERENCES users(id),
  friendship_id text NOT NULL REFERENCES friendships(id)
);
CREATE INDEX friendship_members_by_relation ON active_friendship_members(friendship_id);

CREATE TABLE profile_avatars (
  user_id text PRIMARY KEY REFERENCES users(id),
  version text NOT NULL,
  jpeg bytea NOT NULL CHECK (length(jpeg) BETWEEN 4 AND 122880)
);

