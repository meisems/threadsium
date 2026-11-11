-- Threadsium 0003: on-chain launch index for every launchpad in src/config/launchpads.ts.
-- Additive. worker/launchIndex.ts fills it from Initialize / PoolCreated logs and resumes from the saved cursors.

CREATE TABLE IF NOT EXISTS launch_index_cursors (
  key TEXT PRIMARY KEY,
  next_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS launches (
  launchpad_id TEXT NOT NULL,
  token TEXT NOT NULL,
  pool TEXT NOT NULL,
  emitter TEXT NOT NULL,
  block INTEGER NOT NULL,
  created_at INTEGER,
  symbol TEXT,
  name TEXT,
  PRIMARY KEY (launchpad_id, token)
);

CREATE INDEX IF NOT EXISTS idx_launches_lp_block ON launches(launchpad_id, block DESC);

CREATE INDEX IF NOT EXISTS idx_launches_token ON launches(token);
