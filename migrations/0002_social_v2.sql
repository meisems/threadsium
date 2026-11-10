-- Threadsium 0002: reactions, saved posts, room posts, wallet challenges.
-- Additive. Room comments from 0001 (token_comments) become posts tied to a room, so every
-- conversation uses one post model.

ALTER TABLE likes ADD COLUMN kind TEXT NOT NULL DEFAULT 'like';

ALTER TABLE posts ADD COLUMN room_address TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_room ON posts(room_address, created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  user_id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, read_at);

INSERT OR IGNORE INTO posts (id, author_id, content, token_refs, room_address, created_at)
  SELECT id, author_id, content, '[]', LOWER(token_address), created_at
  FROM token_comments WHERE parent_id IS NULL;

INSERT OR IGNORE INTO post_replies (id, post_id, author_id, content, created_at)
  SELECT c.id, c.parent_id, c.author_id, c.content, c.created_at
  FROM token_comments c
  WHERE c.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.id = c.parent_id);

UPDATE likes SET target_type = 'post'
  WHERE target_type = 'comment' AND target_id IN (SELECT id FROM posts);

UPDATE posts SET
  reply_count = (SELECT COUNT(*) FROM post_replies r WHERE r.post_id = posts.id),
  like_count = (SELECT COUNT(*) FROM likes l WHERE l.target_type = 'post' AND l.target_id = posts.id)
  WHERE room_address IS NOT NULL;

DELETE FROM token_comments;

-- The starter account from 0001 carried a token contract as a "verified wallet". It is a system
-- account with no wallet, so that claim is removed.
UPDATE users SET wallet_address = NULL, wallet_verified = 0, display_name = 'Elysium Desk', avatar_preset = 'saffron',
  bio = 'System account. Posts network notes and the verified contract list for Elysium (chain 99901). Nobody reads its messages.'
  WHERE id = 'u_elysium_desk';
