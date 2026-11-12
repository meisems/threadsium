-- Send / tip: a direct message can carry an on-chain transfer the server checked against its receipt.
-- transfer holds the verified details as JSON; tx_hash keeps one message per transaction.
ALTER TABLE messages ADD COLUMN transfer TEXT;
ALTER TABLE messages ADD COLUMN tx_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tx_hash ON messages(tx_hash) WHERE tx_hash IS NOT NULL;
