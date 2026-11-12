-- Threadsium 0005: Sign-In with Ethereum (EIP-4361) accounts.
-- Additive. worker/siwe.ts issues single-use nonces and worker/auth.ts turns a verified first sign-in into a short-lived
-- sign-up ticket that becomes an account once the visitor picks a username. No key material is ever stored.

CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_siwe_nonces_expires ON siwe_nonces(expires_at);

CREATE TABLE IF NOT EXISTS wallet_signups (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_signups_expires ON wallet_signups(expires_at);
