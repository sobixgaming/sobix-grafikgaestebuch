CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 32),
  pixels TEXT NOT NULL,
  position_x INTEGER NOT NULL,
  position_y INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  network_hash TEXT NOT NULL,
  user_agent TEXT
);
CREATE UNIQUE INDEX one_entry_per_network_day ON entries(network_hash, substr(created_at, 1, 10));
CREATE INDEX entries_created_at ON entries(created_at DESC);
