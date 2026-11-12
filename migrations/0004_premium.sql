-- Threadsium 0004: Premium tiers for wallets holding THREADSIUM (1,000,000 = Premium, 10,000,000 = Premium Max),
-- plus an editable premium badge. Additive. worker/premium.ts writes these columns; a tier is active while
-- premium_until is in the future.

ALTER TABLE users ADD COLUMN premium_until INTEGER;

ALTER TABLE users ADD COLUMN premium_tier TEXT;

ALTER TABLE users ADD COLUMN premium_checked_at INTEGER;

ALTER TABLE users ADD COLUMN premium_balance TEXT;

ALTER TABLE users ADD COLUMN premium_decimals INTEGER;

ALTER TABLE users ADD COLUMN badge_icon TEXT;

ALTER TABLE users ADD COLUMN badge_color TEXT;

ALTER TABLE users ADD COLUMN badge_image_url TEXT;

ALTER TABLE users ADD COLUMN badge_tint INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_premium ON users(premium_until, premium_checked_at);
