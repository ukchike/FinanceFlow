-- FinanceFlow sync relay. The server only ever stores ciphertext: item payloads, group
-- metadata and member labels are encrypted on the phones with a key the server never sees.
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  meta TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS members_group ON members (group_id);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_group ON invites (group_id);
CREATE TABLE IF NOT EXISTS items (
  group_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  author TEXT NOT NULL,
  PRIMARY KEY (group_id, item_id)
);
CREATE INDEX IF NOT EXISTS items_seq ON items (group_id, seq);
CREATE TABLE IF NOT EXISTS counters (
  group_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL
);
