DROP INDEX IF EXISTS one_entry_per_network_day;
CREATE INDEX entries_network_day ON entries(network_hash, substr(created_at, 1, 10));
