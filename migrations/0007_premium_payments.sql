-- Threadsium 0007: pay for Premium / Premium Max in HYPE instead of holding THREADSIUM.
-- Additive. A payment of the tier's token amount, valued in HYPE at a locked quote, buys PREMIUM.paidDays.
-- Payments go to the platform fee wallet; worker/premium.ts verifies each transaction on chain.

ALTER TABLE users ADD COLUMN paid_tier TEXT;

ALTER TABLE users ADD COLUMN paid_until INTEGER;

CREATE TABLE IF NOT EXISTS premium_quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  wallet TEXT NOT NULL,
  price_hype TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_tx TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_premium_quotes_user ON premium_quotes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS premium_payments (
  tx_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  wallet TEXT NOT NULL,
  value_wei TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  paid_at INTEGER NOT NULL,
  until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_premium_payments_user ON premium_payments(user_id, created_at DESC);

-- One payment per quote, so two transactions cannot both claim the same locked price.
CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_payments_quote ON premium_payments(quote_id);
