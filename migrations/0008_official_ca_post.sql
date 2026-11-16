-- Threadsium 0008: Elysium Desk posts the official THREADSIUM contract address.
-- Additive. One post from the system account, in the feed and in the THREADSIUM room, like the Desk's other notes.
-- Skipped when the Desk account does not exist yet (a brand-new database seeds it after migrations run).

INSERT OR IGNORE INTO posts (id, author_id, content, token_refs, room_address, created_at)
SELECT
  'p_official_ca_threadsium',
  'u_elysium_desk',
  '$THREADSIUM is live on Elysium.' || char(10) || char(10) ||
    'Official CA:' || char(10) ||
    '0xa9341ac2d2aaafc65bc68277c1c2885287b84603' || char(10) || char(10) ||
    'This is the only official contract. Hold 1M for Premium, 10M for Premium Max. Check the address before you buy; we never DM a different one.',
  '["THREADSIUM","0xa9341ac2d2aaafc65bc68277c1c2885287b84603"]',
  '0xa9341ac2d2aaafc65bc68277c1c2885287b84603',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'u_elysium_desk');
