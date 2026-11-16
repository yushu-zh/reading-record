CREATE TABLE profile_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  version TEXT NOT NULL,
  jpeg BLOB NOT NULL CHECK(length(jpeg) BETWEEN 4 AND 122880)
);
