CREATE TABLE friendships (
  id TEXT PRIMARY KEY, first_id TEXT NOT NULL REFERENCES users(id),
  second_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%FT%fZ','now')), ended_at TEXT,
  CHECK (first_id <> second_id)
);
CREATE TABLE active_friendship_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id), friendship_id TEXT NOT NULL REFERENCES friendships(id)
);
CREATE INDEX friendship_members_by_relation ON active_friendship_members(friendship_id);
