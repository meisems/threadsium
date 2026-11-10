// Full-stack social endpoints for Threadsium: posts, reposts, quotes, likes, shares, replies,
// token timelines, ratings/sentiment, profiles, follows, connections, notifications, DMs, and analytics.
import { getSessionUser, jsonNoStore, requireMutatingUser, type AuthUser } from "./auth.ts";
import type { Env, SqlDb } from "./env.ts";
import { checkRateLimit } from "./store.ts";

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  bannerUrl: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
  showConnections: boolean;
  pinnedPostId: string | null;
  createdAt: number;
}

export interface ApiPost {
  id: string;
  authorId: string;
  content: string;
  imageUrl: string | null;
  tokenRefs: string[];
  repostOfId: string | null;
  isQuote: boolean;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  shareCount: number;
  createdAt: number;
  updatedAt: number | null;
  author: PublicProfile;
  originalPost: ApiPost | null;
  likedByMe: boolean;
  repostedByMe: boolean;
}

interface RawPostRow {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  token_refs: string;
  repost_of_id: string | null;
  is_quote: number;
  like_count: number;
  repost_count: number;
  reply_count: number;
  share_count: number;
  created_at: number;
  updated_at: number | null;
  u_id: string;
  u_username: string;
  u_display_name: string;
  u_bio: string;
  u_avatar_url: string | null;
  u_avatar_preset: string | null;
  u_banner_url: string | null;
  u_wallet_address: string | null;
  u_wallet_verified: number;
  u_show_connections: number;
  u_pinned_post_id: string | null;
  u_created_at: number;
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function extractTokenRefs(content: string): string[] {
  const refs = new Set<string>();
  const TICKER_RE = /\$([A-Za-z0-9]{1,11})\b/g;
  const ADDR_RE = /(0x[a-fA-F0-9]{40})/g;
  const TAG_RE = /(#[A-Za-z0-9_]{1,50})\b/g;
  let m: RegExpExecArray | null;
  while ((m = TICKER_RE.exec(content)) !== null) refs.add(m[1].toUpperCase());
  while ((m = ADDR_RE.exec(content)) !== null) refs.add(m[1].toLowerCase());
  while ((m = TAG_RE.exec(content)) !== null) refs.add(m[1].toLowerCase());
  return [...refs];
}

function mapAuthor(r: RawPostRow): PublicProfile {
  return {
    id: r.u_id,
    username: r.u_username,
    displayName: r.u_display_name || r.u_username,
    bio: r.u_bio || "",
    avatarUrl: r.u_avatar_url,
    avatarPreset: r.u_avatar_preset,
    bannerUrl: r.u_banner_url,
    walletAddress: r.u_wallet_address,
    walletVerified: !!r.u_wallet_verified,
    showConnections: r.u_show_connections !== 0,
    pinnedPostId: r.u_pinned_post_id,
    createdAt: r.u_created_at,
  };
}

const POST_SELECT = `
  SELECT
    p.*,
    u.id AS u_id,
    u.username AS u_username,
    u.display_name AS u_display_name,
    u.bio AS u_bio,
    u.avatar_url AS u_avatar_url,
    u.avatar_preset AS u_avatar_preset,
    u.banner_url AS u_banner_url,
    u.wallet_address AS u_wallet_address,
    u.wallet_verified AS u_wallet_verified,
    u.show_connections AS u_show_connections,
    u.pinned_post_id AS u_pinned_post_id,
    u.created_at AS u_created_at
  FROM posts p
  JOIN users u ON u.id = p.author_id
`;

async function hydratePosts(db: SqlDb, rows: RawPostRow[], viewer: AuthUser | null): Promise<ApiPost[]> {
  if (!rows.length) return [];

  const origIds = [...new Set(rows.map((r) => r.repost_of_id).filter(Boolean) as string[])];
  const origMap = new Map<string, RawPostRow>();
  for (const oid of origIds) {
    const o = await db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(oid).first<RawPostRow>();
    if (o) origMap.set(oid, o);
  }

  const allIds = [...new Set([...rows.map((r) => r.id), ...origIds])];
  const likedSet = new Set<string>();
  const repostedSet = new Set<string>();

  if (viewer && allIds.length > 0) {
    const likes = await db
      .prepare("SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'post'")
      .bind(viewer.id)
      .all<{ target_id: string }>();
    for (const l of likes.results) likedSet.add(l.target_id);

    const reps = await db
      .prepare("SELECT post_id FROM reposts WHERE user_id = ?")
      .bind(viewer.id)
      .all<{ post_id: string }>();
    for (const rp of reps.results) repostedSet.add(rp.post_id);
  }

  const toPost = (r: RawPostRow, includeOrig: boolean): ApiPost => {
    let refs: string[] = [];
    try {
      refs = JSON.parse(r.token_refs || "[]");
    } catch {
      refs = [];
    }
    const origRow = includeOrig && r.repost_of_id ? origMap.get(r.repost_of_id) : undefined;
    return {
      id: r.id,
      authorId: r.author_id,
      content: r.content,
      imageUrl: r.image_url,
      tokenRefs: Array.isArray(refs) ? refs : [],
      repostOfId: r.repost_of_id,
      isQuote: !!r.is_quote,
      likeCount: Number(r.like_count || 0),
      repostCount: Number(r.repost_count || 0),
      replyCount: Number(r.reply_count || 0),
      shareCount: Number(r.share_count || 0),
      createdAt: Number(r.created_at),
      updatedAt: r.updated_at ? Number(r.updated_at) : null,
      author: mapAuthor(r),
      originalPost: origRow ? toPost(origRow, false) : null,
      likedByMe: likedSet.has(r.id),
      repostedByMe: repostedSet.has(r.id),
    };
  };

  return rows.map((r) => toPost(r, true));
}

export async function handleListPosts(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return jsonNoStore({ posts: [] });
  const viewer = await getSessionUser(req, env);
  const url = new URL(req.url);
  const feed = url.searchParams.get("feed") || "all";
  const author = url.searchParams.get("author");
  const token = url.searchParams.get("token");
  const symbol = url.searchParams.get("symbol");
  const limit = Math.min(80, Math.max(1, Number(url.searchParams.get("limit")) || 40));

  let rows: RawPostRow[] = [];

  if (feed === "following") {
    if (!viewer) return jsonNoStore({ posts: [] });
    const res = await env.DB.prepare(
      `${POST_SELECT}
       WHERE p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY p.created_at DESC LIMIT ?`,
    )
      .bind(viewer.id, limit)
      .all<RawPostRow>();
    rows = res.results;
  } else if (author) {
    const res = await env.DB.prepare(
      `${POST_SELECT} WHERE u.username = ? COLLATE NOCASE ORDER BY p.created_at DESC LIMIT ?`,
    )
      .bind(author.trim(), limit)
      .all<RawPostRow>();
    rows = res.results;
  } else if (token) {
    const addr = token.trim().toLowerCase();
    const sym = (symbol || "").trim().toUpperCase();
    const allRes = await env.DB.prepare(`${POST_SELECT} ORDER BY p.created_at DESC LIMIT 120`).all<RawPostRow>();
    rows = allRes.results.filter((r) => {
      const c = r.content.toLowerCase();
      if (addr && c.includes(addr)) return true;
      if (sym && r.content.toUpperCase().includes(`$${sym}`)) return true;
      return false;
    }).slice(0, limit);
  } else {
    const res = await env.DB.prepare(`${POST_SELECT} ORDER BY p.created_at DESC LIMIT ?`).bind(limit).all<RawPostRow>();
    rows = res.results;
  }

  const posts = await hydratePosts(env.DB, rows, viewer);
  return jsonNoStore({ posts });
}

export async function handleGetPost(req: Request, env: Env, postId: string): Promise<Response> {
  if (!env.DB) return jsonNoStore({ error: "Not found" }, 404);
  const viewer = await getSessionUser(req, env);
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(postId).first<RawPostRow>();
  if (!row) return jsonNoStore({ error: "Post not found" }, 404);
  const [post] = await hydratePosts(env.DB, [row], viewer);
  return jsonNoStore({ post });
}

export async function handleCreatePost(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `post:${user.id}`, 25, 600_000))) {
    return jsonNoStore({ error: "Posting rate limit reached. Try again shortly." }, 429);
  }

  let body: { content?: unknown; imageUrl?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.startsWith("/api/media/") ? body.imageUrl : null;

  if (!content && !imageUrl) {
    return jsonNoStore({ error: "Post must include text or an image." }, 400);
  }
  if (content.length > 500) {
    return jsonNoStore({ error: "Post text must be 500 characters or fewer." }, 400);
  }

  const id = uid("p");
  const now = Date.now();
  const refs = extractTokenRefs(content);

  await env.DB.prepare(
    `INSERT INTO posts (id, author_id, content, image_url, token_refs, repost_of_id, is_quote, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`,
  )
    .bind(id, user.id, content, imageUrl, JSON.stringify(refs), now)
    .run();

  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<RawPostRow>();
  const [post] = row ? await hydratePosts(env.DB, [row], user) : [null];
  return jsonNoStore({ post, id }, 201);
}

export async function handleUpdatePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const existing = await env.DB.prepare("SELECT author_id, repost_of_id, is_quote FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ author_id: string; repost_of_id: string | null; is_quote: number }>();

  if (!existing) return jsonNoStore({ error: "Post not found." }, 404);
  if (existing.author_id !== auth.user.id) return jsonNoStore({ error: "Not authorized to edit this post." }, 403);
  if (existing.repost_of_id && !existing.is_quote) return jsonNoStore({ error: "Pure reposts cannot be edited." }, 400);

  let body: { content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 500) {
    return jsonNoStore({ error: "Post text must be 1-500 characters." }, 400);
  }

  const refs = extractTokenRefs(content);
  const now = Date.now();
  await env.DB.prepare("UPDATE posts SET content = ?, token_refs = ?, updated_at = ? WHERE id = ? AND author_id = ?")
    .bind(content, JSON.stringify(refs), now, postId, auth.user.id)
    .run();

  return jsonNoStore({ ok: true, content, tokenRefs: refs, updatedAt: now });
}

export async function handleDeletePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const existing = await env.DB.prepare("SELECT author_id FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ author_id: string }>();
  if (!existing) return jsonNoStore({ error: "Post not found." }, 404);
  if (existing.author_id !== auth.user.id) return jsonNoStore({ error: "Not authorized to delete this post." }, 403);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pinned_post_id = NULL WHERE pinned_post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM posts WHERE id = ? AND author_id = ?").bind(postId, auth.user.id),
  ]);

  return jsonNoStore({ ok: true });
}

export async function handleToggleLikePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const post = await env.DB.prepare("SELECT id, author_id, like_count FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; author_id: string; like_count: number }>();
  if (!post) return jsonNoStore({ error: "Post not found." }, 404);

  const existing = await env.DB.prepare(
    "SELECT id FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?",
  )
    .bind(auth.user.id, postId)
    .first<{ id: string }>();

  const now = Date.now();
  if (existing) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(existing.id),
      env.DB.prepare("UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(postId),
    ]);
    return jsonNoStore({ liked: false, likeCount: Math.max(0, Number(post.like_count) - 1) });
  } else {
    const stmts = [
      env.DB.prepare("INSERT INTO likes (id, user_id, target_type, target_id, created_at) VALUES (?, ?, 'post', ?, ?)")
        .bind(uid("lk"), auth.user.id, postId, now),
      env.DB.prepare("UPDATE posts SET like_count = like_count + 1 WHERE id = ?").bind(postId),
    ];
    if (post.author_id !== auth.user.id) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'like', ?, ?, ?)",
        ).bind(uid("nt"), post.author_id, auth.user.id, `@${auth.user.username} liked your thread`, `/app/post/${postId}`, now),
      );
    }
    await env.DB.batch(stmts);
    return jsonNoStore({ liked: true, likeCount: Number(post.like_count) + 1 });
  }
}

export async function handleRepost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const orig = await env.DB.prepare("SELECT id, author_id, repost_count FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; author_id: string; repost_count: number }>();
  if (!orig) return jsonNoStore({ error: "Post not found." }, 404);

  const existing = await env.DB.prepare("SELECT id FROM reposts WHERE user_id = ? AND post_id = ?")
    .bind(auth.user.id, postId)
    .first<{ id: string }>();

  const now = Date.now();
  if (req.method === "DELETE" || existing) {
    if (!existing) return jsonNoStore({ reposted: false, repostCount: Number(orig.repost_count) });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reposts WHERE id = ?").bind(existing.id),
      env.DB.prepare("DELETE FROM posts WHERE author_id = ? AND repost_of_id = ? AND is_quote = 0").bind(auth.user.id, postId),
      env.DB.prepare("UPDATE posts SET repost_count = MAX(0, repost_count - 1) WHERE id = ?").bind(postId),
    ]);
    return jsonNoStore({ reposted: false, repostCount: Math.max(0, Number(orig.repost_count) - 1) });
  }

  const newPostId = uid("p");
  const stmts = [
    env.DB.prepare("INSERT INTO reposts (id, user_id, post_id, created_at) VALUES (?, ?, ?, ?)").bind(
      uid("rp"),
      auth.user.id,
      postId,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO posts (id, author_id, content, token_refs, repost_of_id, is_quote, created_at) VALUES (?, ?, '', '[]', ?, 0, ?)",
    ).bind(newPostId, auth.user.id, postId, now),
    env.DB.prepare("UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?").bind(postId),
  ];
  if (orig.author_id !== auth.user.id) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'repost', ?, ?, ?)",
      ).bind(uid("nt"), orig.author_id, auth.user.id, `@${auth.user.username} rethreaded your post`, `/app/post/${postId}`, now),
    );
  }
  await env.DB.batch(stmts);
  return jsonNoStore({ reposted: true, repostCount: Number(orig.repost_count) + 1, id: newPostId });
}

export async function handleQuotePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const orig = await env.DB.prepare("SELECT id, author_id, repost_count FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; author_id: string; repost_count: number }>();
  if (!orig) return jsonNoStore({ error: "Original post not found." }, 404);

  let body: { content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 280) {
    return jsonNoStore({ error: "Quote text must be 1-280 characters." }, 400);
  }

  const now = Date.now();
  const newId = uid("p");
  const refs = extractTokenRefs(content);
  const stmts = [
    env.DB.prepare(
      "INSERT INTO posts (id, author_id, content, token_refs, repost_of_id, is_quote, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    ).bind(newId, auth.user.id, content, JSON.stringify(refs), postId, now),
    env.DB.prepare("UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?").bind(postId),
  ];
  if (orig.author_id !== auth.user.id) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'quote', ?, ?, ?)",
      ).bind(uid("nt"), orig.author_id, auth.user.id, `@${auth.user.username} quoted your post`, `/app/post/${newId}`, now),
    );
  }
  await env.DB.batch(stmts);
  return jsonNoStore({ id: newId, repostCount: Number(orig.repost_count) + 1 }, 201);
}

export async function handleSharePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const orig = await env.DB.prepare("SELECT id, share_count FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; share_count: number }>();
  if (!orig) return jsonNoStore({ error: "Post not found." }, 404);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO post_shares (id, user_id, post_id, created_at) VALUES (?, ?, ?, ?)").bind(
      uid("sh"),
      auth.user.id,
      postId,
      now,
    ),
    env.DB.prepare("UPDATE posts SET share_count = share_count + 1 WHERE id = ?").bind(postId),
  ]);
  return jsonNoStore({ shareCount: Number(orig.share_count) + 1 });
}

export async function handlePinPost(req: Request, env: Env, postId: string | null): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  if (!postId) {
    await env.DB.prepare("UPDATE users SET pinned_post_id = NULL WHERE id = ?").bind(auth.user.id).run();
    return jsonNoStore({ pinnedPostId: null });
  }

  const p = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; author_id: string }>();
  if (!p || p.author_id !== auth.user.id) {
    return jsonNoStore({ error: "You can only pin your own posts." }, 403);
  }
  await env.DB.prepare("UPDATE users SET pinned_post_id = ? WHERE id = ?").bind(postId, auth.user.id).run();
  return jsonNoStore({ pinnedPostId: postId });
}

export async function handlePostReplies(req: Request, env: Env, postId: string): Promise<Response> {
  if (!env.DB) return jsonNoStore({ replies: [] });

  if (req.method === "GET") {
    const res = await env.DB.prepare(
      `SELECT r.*, u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
              u.avatar_url AS u_avatar_url, u.avatar_preset AS u_avatar_preset,
              u.wallet_address AS u_wallet_address, u.wallet_verified AS u_wallet_verified
       FROM post_replies r
       JOIN users u ON u.id = r.author_id
       WHERE r.post_id = ?
       ORDER BY r.created_at ASC`,
    )
      .bind(postId)
      .all<{
        id: string;
        post_id: string;
        author_id: string;
        parent_reply_id: string | null;
        content: string;
        created_at: number;
        updated_at: number | null;
        u_id: string;
        u_username: string;
        u_display_name: string;
        u_avatar_url: string | null;
        u_avatar_preset: string | null;
        u_wallet_address: string | null;
        u_wallet_verified: number;
      }>();

    const replies = res.results.map((r) => ({
      id: r.id,
      postId: r.post_id,
      authorId: r.author_id,
      parentReplyId: r.parent_reply_id,
      content: r.content,
      createdAt: Number(r.created_at),
      updatedAt: r.updated_at ? Number(r.updated_at) : null,
      author: {
        id: r.u_id,
        username: r.u_username,
        displayName: r.u_display_name || r.u_username,
        avatarUrl: r.u_avatar_url,
        avatarPreset: r.u_avatar_preset,
        walletAddress: r.u_wallet_address,
        walletVerified: !!r.u_wallet_verified,
      },
    }));
    return jsonNoStore({ replies });
  }

  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;

  const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ?")
    .bind(postId)
    .first<{ id: string; author_id: string }>();
  if (!post) return jsonNoStore({ error: "Post not found." }, 404);

  let body: { content?: unknown; parentReplyId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parentReplyId = typeof body.parentReplyId === "string" && body.parentReplyId ? body.parentReplyId : null;
  if (!content || content.length > 280) {
    return jsonNoStore({ error: "Reply must be 1-280 characters." }, 400);
  }

  const id = uid("pr");
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO post_replies (id, post_id, author_id, parent_reply_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, postId, auth.user.id, parentReplyId, content, now),
    env.DB.prepare("UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?").bind(postId),
  ];
  if (post.author_id !== auth.user.id) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'reply', ?, ?, ?)",
      ).bind(uid("nt"), post.author_id, auth.user.id, `@${auth.user.username} replied to your thread`, `/app/post/${postId}`, now),
    );
  }
  await env.DB.batch(stmts);
  return jsonNoStore({ id }, 201);
}

export async function handleModifyReply(req: Request, env: Env, replyId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const row = await env.DB.prepare("SELECT id, post_id, author_id FROM post_replies WHERE id = ?")
    .bind(replyId)
    .first<{ id: string; post_id: string; author_id: string }>();
  if (!row) return jsonNoStore({ error: "Reply not found." }, 404);
  if (row.author_id !== auth.user.id) return jsonNoStore({ error: "Not authorized." }, 403);

  if (req.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM post_replies WHERE id = ? OR parent_reply_id = ?").bind(replyId, replyId),
      env.DB.prepare("UPDATE posts SET reply_count = MAX(0, reply_count - 1) WHERE id = ?").bind(row.post_id),
    ]);
    return jsonNoStore({ ok: true });
  }

  let body: { content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 280) return jsonNoStore({ error: "Reply must be 1-280 characters." }, 400);

  await env.DB.prepare("UPDATE post_replies SET content = ?, updated_at = ? WHERE id = ? AND author_id = ?")
    .bind(content, Date.now(), replyId, auth.user.id)
    .run();
  return jsonNoStore({ ok: true });
}

export async function handleTokenSocial(req: Request, env: Env, rawAddress: string): Promise<Response> {
  if (!env.DB) return jsonNoStore({ comments: [], stats: { bullish: 0, bearish: 0, avgRating: 0, ratingCount: 0 } });
  const addr = rawAddress.trim().toLowerCase();
  const viewer = await getSessionUser(req, env);

  const [commentsRes, votesRes] = await Promise.all([
    env.DB.prepare(
      `SELECT c.*, u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
              u.avatar_url AS u_avatar_url, u.avatar_preset AS u_avatar_preset,
              u.wallet_address AS u_wallet_address, u.wallet_verified AS u_wallet_verified
       FROM token_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.token_address = ?
       ORDER BY c.created_at DESC LIMIT 100`,
    )
      .bind(addr)
      .all<{
        id: string;
        author_id: string;
        token_address: string;
        content: string;
        parent_id: string | null;
        like_count: number;
        created_at: number;
        u_id: string;
        u_username: string;
        u_display_name: string;
        u_avatar_url: string | null;
        u_avatar_preset: string | null;
        u_wallet_address: string | null;
        u_wallet_verified: number;
      }>(),
    env.DB.prepare("SELECT user_id, rating, sentiment FROM token_votes WHERE token_address = ?")
      .bind(addr)
      .all<{ user_id: string; rating: number | null; sentiment: "bullish" | "bearish" | null }>(),
  ]);

  const likedComments = new Set<string>();
  if (viewer) {
    const lk = await env.DB.prepare("SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'comment'")
      .bind(viewer.id)
      .all<{ target_id: string }>();
    for (const l of lk.results) likedComments.add(l.target_id);
  }

  let bullish = 0;
  let bearish = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  let myVote: { rating: number | null; sentiment: "bullish" | "bearish" | null } = { rating: null, sentiment: null };

  for (const v of votesRes.results) {
    if (v.sentiment === "bullish") bullish++;
    if (v.sentiment === "bearish") bearish++;
    if (typeof v.rating === "number" && v.rating >= 1 && v.rating <= 5) {
      ratingSum += v.rating;
      ratingCount++;
    }
    if (viewer && v.user_id === viewer.id) {
      myVote = { rating: v.rating, sentiment: v.sentiment };
    }
  }

  const comments = commentsRes.results.map((c) => ({
    id: c.id,
    authorId: c.author_id,
    tokenAddress: c.token_address,
    content: c.content,
    parentId: c.parent_id,
    likeCount: Number(c.like_count || 0),
    createdAt: Number(c.created_at),
    likedByMe: likedComments.has(c.id),
    author: {
      id: c.u_id,
      username: c.u_username,
      displayName: c.u_display_name || c.u_username,
      avatarUrl: c.u_avatar_url,
      avatarPreset: c.u_avatar_preset,
      walletAddress: c.u_wallet_address,
      walletVerified: !!c.u_wallet_verified,
    },
  }));

  return jsonNoStore({
    comments,
    stats: {
      bullish,
      bearish,
      avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      ratingCount,
      myRating: myVote.rating,
      mySentiment: myVote.sentiment,
    },
  });
}

export async function handleCreateTokenComment(req: Request, env: Env, rawAddress: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const addr = rawAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return jsonNoStore({ error: "Invalid token address." }, 400);
  }

  let body: { content?: unknown; parentId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  if (!content || content.length > 500) {
    return jsonNoStore({ error: "Comment must be 1-500 characters." }, 400);
  }

  const id = uid("tc");
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO token_comments (id, author_id, token_address, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, auth.user.id, addr, content, parentId, now)
    .run();

  return jsonNoStore({ id }, 201);
}

export async function handleDeleteTokenComment(req: Request, env: Env, commentId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const row = await env.DB.prepare("SELECT id, author_id FROM token_comments WHERE id = ?")
    .bind(commentId)
    .first<{ id: string; author_id: string }>();
  if (!row) return jsonNoStore({ error: "Comment not found." }, 404);
  if (row.author_id !== auth.user.id) return jsonNoStore({ error: "Not authorized." }, 403);

  await env.DB.prepare("DELETE FROM token_comments WHERE id = ? OR parent_id = ?").bind(commentId, commentId).run();
  return jsonNoStore({ ok: true });
}

export async function handleLikeTokenComment(req: Request, env: Env, commentId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const comment = await env.DB.prepare("SELECT id, like_count FROM token_comments WHERE id = ?")
    .bind(commentId)
    .first<{ id: string; like_count: number }>();
  if (!comment) return jsonNoStore({ error: "Comment not found." }, 404);

  const existing = await env.DB.prepare(
    "SELECT id FROM likes WHERE user_id = ? AND target_type = 'comment' AND target_id = ?",
  )
    .bind(auth.user.id, commentId)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(existing.id),
      env.DB.prepare("UPDATE token_comments SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(commentId),
    ]);
    return jsonNoStore({ liked: false, likeCount: Math.max(0, Number(comment.like_count) - 1) });
  } else {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO likes (id, user_id, target_type, target_id, created_at) VALUES (?, ?, 'comment', ?, ?)")
        .bind(uid("lk"), auth.user.id, commentId, Date.now()),
      env.DB.prepare("UPDATE token_comments SET like_count = like_count + 1 WHERE id = ?").bind(commentId),
    ]);
    return jsonNoStore({ liked: true, likeCount: Number(comment.like_count) + 1 });
  }
}

export async function handleTokenVote(req: Request, env: Env, rawAddress: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const addr = rawAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return jsonNoStore({ error: "Invalid token address." }, 400);

  let body: { rating?: unknown; sentiment?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const current = await env.DB.prepare("SELECT rating, sentiment FROM token_votes WHERE user_id = ? AND token_address = ?")
    .bind(auth.user.id, addr)
    .first<{ rating: number | null; sentiment: string | null }>();

  let rating = current?.rating ?? null;
  let sentiment = current?.sentiment ?? null;

  if (body.rating !== undefined) {
    const r = Number(body.rating);
    rating = r >= 1 && r <= 5 ? Math.round(r) : null;
  }
  if (body.sentiment !== undefined) {
    sentiment = body.sentiment === "bullish" || body.sentiment === "bearish" ? body.sentiment : null;
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO token_votes (user_id, token_address, rating, sentiment, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(auth.user.id, addr, rating, sentiment, Date.now())
    .run();

  return handleTokenSocial(req, env, addr);
}

export async function handleGetProfile(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return jsonNoStore({ error: "Not found" }, 404);
  const viewer = await getSessionUser(req, env);

  const u = await env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username.trim())
    .first<{
      id: string;
      username: string;
      display_name: string;
      bio: string;
      avatar_url: string | null;
      avatar_preset: string | null;
      banner_url: string | null;
      wallet_address: string | null;
      wallet_verified: number;
      show_connections: number;
      pinned_post_id: string | null;
      created_at: number;
    }>();

  if (!u) return jsonNoStore({ error: "Profile not found." }, 404);

  const [followersRes, followingRes, isFollowingRes, commentsRes] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?").bind(u.id).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?").bind(u.id).first<{ c: number }>(),
    viewer
      ? env.DB.prepare("SELECT follower_id FROM follows WHERE follower_id = ? AND following_id = ?")
          .bind(viewer.id, u.id)
          .first<{ follower_id: string }>()
      : Promise.resolve(null),
    env.DB.prepare("SELECT * FROM token_comments WHERE author_id = ? ORDER BY created_at DESC LIMIT 60")
      .bind(u.id)
      .all<{
        id: string;
        token_address: string;
        content: string;
        parent_id: string | null;
        like_count: number;
        created_at: number;
      }>(),
  ]);

  let pinnedPost: ApiPost | null = null;
  if (u.pinned_post_id) {
    const pRow = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ? AND p.author_id = ?`)
      .bind(u.pinned_post_id, u.id)
      .first<RawPostRow>();
    if (pRow) {
      const [hydrated] = await hydratePosts(env.DB, [pRow], viewer);
      pinnedPost = hydrated ?? null;
    }
  }

  return jsonNoStore({
    profile: {
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      bio: u.bio || "",
      avatarUrl: u.avatar_url,
      avatarPreset: u.avatar_preset,
      bannerUrl: u.banner_url,
      walletAddress: u.wallet_address,
      walletVerified: !!u.wallet_verified,
      showConnections: u.show_connections !== 0,
      pinnedPostId: u.pinned_post_id,
      createdAt: Number(u.created_at),
    },
    followStats: {
      followers: Number(followersRes?.c ?? 0),
      following: Number(followingRes?.c ?? 0),
    },
    isFollowing: !!isFollowingRes,
    pinnedPost,
    tokenComments: commentsRes.results.map((c) => ({
      id: c.id,
      tokenAddress: c.token_address,
      content: c.content,
      parentId: c.parent_id,
      likeCount: Number(c.like_count || 0),
      createdAt: Number(c.created_at),
    })),
  });
}

export async function handleToggleFollow(req: Request, env: Env, username: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const target = await env.DB.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username.trim())
    .first<{ id: string; username: string }>();
  if (!target) return jsonNoStore({ error: "User not found." }, 404);
  if (target.id === auth.user.id) return jsonNoStore({ error: "You cannot follow yourself." }, 400);

  const existing = await env.DB.prepare("SELECT follower_id FROM follows WHERE follower_id = ? AND following_id = ?")
    .bind(auth.user.id, target.id)
    .first<{ follower_id: string }>();

  const now = Date.now();
  if (existing) {
    await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?")
      .bind(auth.user.id, target.id)
      .run();
    return jsonNoStore({ following: false });
  } else {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)").bind(
        auth.user.id,
        target.id,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'follow', ?, ?, ?)",
      ).bind(uid("nt"), target.id, auth.user.id, `@${auth.user.username} followed you`, `/app/u/${auth.user.username}`, now),
    ]);
    return jsonNoStore({ following: true });
  }
}

export async function handleGetConnections(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return jsonNoStore({ connections: [], hidden: false });
  const viewer = await getSessionUser(req, env);
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "following" ? "following" : "followers";

  const target = await env.DB.prepare("SELECT id, show_connections FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username.trim())
    .first<{ id: string; show_connections: number }>();
  if (!target) return jsonNoStore({ error: "User not found." }, 404);

  if (target.show_connections === 0 && viewer?.id !== target.id) {
    return jsonNoStore({ connections: [], hidden: true });
  }

  const query =
    tab === "followers"
      ? `SELECT u.id, u.username, u.display_name, u.avatar_url, u.avatar_preset, u.wallet_address, u.wallet_verified
         FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 100`
      : `SELECT u.id, u.username, u.display_name, u.avatar_url, u.avatar_preset, u.wallet_address, u.wallet_verified
         FROM follows f JOIN users u ON u.id = f.following_id
         WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100`;

  const res = await env.DB.prepare(query).bind(target.id).all<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    avatar_preset: string | null;
    wallet_address: string | null;
    wallet_verified: number;
  }>();

  return jsonNoStore({
    hidden: false,
    connections: res.results.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      avatarUrl: u.avatar_url,
      avatarPreset: u.avatar_preset,
      walletAddress: u.wallet_address,
      walletVerified: !!u.wallet_verified,
    })),
  });
}

export async function handleSearch(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return jsonNoStore({ profiles: [], posts: [] });
  const viewer = await getSessionUser(req, env);
  const url = new URL(req.url);
  const rawQ = (url.searchParams.get("q") || "").trim();
  if (!rawQ) return jsonNoStore({ profiles: [], posts: [] });

  const cleanQ = rawQ.replace(/^@/, "").toLowerCase();
  const [usersRes, postsRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, username, display_name, bio, avatar_url, avatar_preset, wallet_address, wallet_verified
       FROM users
       WHERE LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?
       ORDER BY username ASC LIMIT 20`,
    )
      .bind(`%${cleanQ}%`, `%${cleanQ}%`)
      .all<{
        id: string;
        username: string;
        display_name: string;
        bio: string;
        avatar_url: string | null;
        avatar_preset: string | null;
        wallet_address: string | null;
        wallet_verified: number;
      }>(),
    env.DB.prepare(`${POST_SELECT} WHERE LOWER(p.content) LIKE ? ORDER BY p.created_at DESC LIMIT 30`)
      .bind(`%${rawQ.toLowerCase()}%`)
      .all<RawPostRow>(),
  ]);

  const posts = await hydratePosts(env.DB, postsRes.results, viewer);
  return jsonNoStore({
    profiles: usersRes.results.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      bio: u.bio || "",
      avatarUrl: u.avatar_url,
      avatarPreset: u.avatar_preset,
      walletAddress: u.wallet_address,
      walletVerified: !!u.wallet_verified,
    })),
    posts,
  });
}

export async function handleNotifications(req: Request, env: Env): Promise<Response> {
  const viewer = await getSessionUser(req, env);
  if (!viewer || !env.DB) return jsonNoStore({ notifications: [] });

  if (req.method === "POST") {
    const auth = await requireMutatingUser(req, env);
    if ("error" in auth) return auth.error;
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL")
      .bind(Date.now(), viewer.id)
      .run();
    return jsonNoStore({ ok: true });
  }

  const cutoff = Date.now() - 12 * 3600_000;
  const res = await env.DB.prepare(
    "SELECT * FROM notifications WHERE recipient_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 60",
  )
    .bind(viewer.id, cutoff)
    .all<{
      id: string;
      recipient_id: string;
      actor_id: string | null;
      type: string;
      message: string;
      link: string | null;
      read_at: number | null;
      created_at: number;
    }>();

  return jsonNoStore({
    notifications: res.results.map((n) => ({
      id: n.id,
      recipientId: n.recipient_id,
      actorId: n.actor_id,
      type: n.type,
      message: n.message,
      link: n.link,
      readAt: n.read_at ? Number(n.read_at) : null,
      createdAt: Number(n.created_at),
    })),
  });
}

export async function handleMessages(req: Request, env: Env): Promise<Response> {
  const viewer = await getSessionUser(req, env);
  if (!viewer || !env.DB) return jsonNoStore({ messages: [], participants: [] });

  if (req.method === "GET") {
    const [msgsRes, connRes] = await Promise.all([
      env.DB.prepare(
        `SELECT m.*,
                su.username AS s_username, su.display_name AS s_display_name, su.avatar_url AS s_avatar_url, su.avatar_preset AS s_avatar_preset,
                ru.username AS r_username, ru.display_name AS r_display_name, ru.avatar_url AS r_avatar_url, ru.avatar_preset AS r_avatar_preset
         FROM messages m
         JOIN users su ON su.id = m.sender_id
         JOIN users ru ON ru.id = m.recipient_id
         WHERE m.sender_id = ? OR m.recipient_id = ?
         ORDER BY m.created_at ASC LIMIT 200`,
      )
        .bind(viewer.id, viewer.id)
        .all<{
          id: string;
          sender_id: string;
          recipient_id: string;
          content: string;
          read_at: number | null;
          created_at: number;
          s_username: string;
          s_display_name: string;
          s_avatar_url: string | null;
          s_avatar_preset: string | null;
          r_username: string;
          r_display_name: string;
          r_avatar_url: string | null;
          r_avatar_preset: string | null;
        }>(),
      env.DB.prepare(
        `SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_url, u.avatar_preset
         FROM users u
         WHERE u.id IN (
           SELECT following_id FROM follows WHERE follower_id = ?
           UNION
           SELECT follower_id FROM follows WHERE following_id = ?
         ) AND u.id <> ?`,
      )
        .bind(viewer.id, viewer.id, viewer.id)
        .all<{
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          avatar_preset: string | null;
        }>(),
    ]);

    const partMap = new Map<
      string,
      { id: string; username: string; displayName: string; avatarUrl: string | null; avatarPreset: string | null }
    >();
    for (const c of connRes.results) {
      partMap.set(c.id, {
        id: c.id,
        username: c.username,
        displayName: c.display_name || c.username,
        avatarUrl: c.avatar_url,
        avatarPreset: c.avatar_preset,
      });
    }
    for (const m of msgsRes.results) {
      const otherId = m.sender_id === viewer.id ? m.recipient_id : m.sender_id;
      if (!partMap.has(otherId)) {
        partMap.set(
          otherId,
          m.sender_id === viewer.id
            ? {
                id: m.recipient_id,
                username: m.r_username,
                displayName: m.r_display_name || m.r_username,
                avatarUrl: m.r_avatar_url,
                avatarPreset: m.r_avatar_preset,
              }
            : {
                id: m.sender_id,
                username: m.s_username,
                displayName: m.s_display_name || m.s_username,
                avatarUrl: m.s_avatar_url,
                avatarPreset: m.s_avatar_preset,
              },
        );
      }
    }

    return jsonNoStore({
      messages: msgsRes.results.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        recipientId: m.recipient_id,
        content: m.content,
        readAt: m.read_at ? Number(m.read_at) : null,
        createdAt: Number(m.created_at),
      })),
      participants: [...partMap.values()],
    });
  }

  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  if (url.pathname.endsWith("/read")) {
    await env.DB.prepare("UPDATE messages SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL")
      .bind(Date.now(), viewer.id)
      .run();
    return jsonNoStore({ ok: true });
  }

  if (!(await checkRateLimit(env.DB, `msg:${viewer.id}`, 40, 600_000))) {
    return jsonNoStore({ error: "Message rate limit reached." }, 429);
  }

  let body: { recipientId?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const recipientId = typeof body.recipientId === "string" ? body.recipientId.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!recipientId || recipientId === viewer.id) {
    return jsonNoStore({ error: "Invalid recipient." }, 400);
  }
  if (!content || content.length > 1000) {
    return jsonNoStore({ error: "Message must be 1-1000 characters." }, 400);
  }

  const recip = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(recipientId).first<{ id: string }>();
  if (!recip) return jsonNoStore({ error: "Recipient not found." }, 404);

  const id = uid("dm");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?, ?)").bind(
      id,
      viewer.id,
      recipientId,
      content,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, 'message', ?, '/app/messages', ?)",
    ).bind(uid("nt"), recipientId, viewer.id, `@${viewer.username} sent you a message`, now),
  ]);

  return jsonNoStore({
    message: {
      id,
      senderId: viewer.id,
      recipientId,
      content,
      readAt: null,
      createdAt: now,
    },
  }, 201);
}

export async function handleMyAnalytics(req: Request, env: Env): Promise<Response> {
  const viewer = await getSessionUser(req, env);
  if (!viewer || !env.DB) return jsonNoStore({ error: "Authentication required." }, 401);

  const uidVal = viewer.id;
  const [posts, likesRec, commentsWritten, repliesWritten, repliesRec, repostsRec, quotesRec, sharesRec, likesGiven, repostsGiven] =
    await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND repost_of_id IS NULL").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COALESCE(SUM(like_count), 0) AS c FROM posts WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM token_comments WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM post_replies WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COALESCE(SUM(reply_count), 0) AS c FROM posts WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COALESCE(SUM(repost_count), 0) AS c FROM posts WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare(
        "SELECT COUNT(*) AS c FROM posts q JOIN posts o ON o.id = q.repost_of_id WHERE o.author_id = ? AND q.is_quote = 1",
      ).bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COALESCE(SUM(share_count), 0) AS c FROM posts WHERE author_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM likes WHERE user_id = ?").bind(uidVal).first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM reposts WHERE user_id = ?").bind(uidVal).first<{ c: number }>(),
    ]);

  return jsonNoStore({
    analytics: {
      posts: Number(posts?.c ?? 0),
      likesReceived: Number(likesRec?.c ?? 0),
      commentsWritten: Number(commentsWritten?.c ?? 0) + Number(repliesWritten?.c ?? 0),
      repliesReceived: Number(repliesRec?.c ?? 0),
      repostsReceived: Number(repostsRec?.c ?? 0),
      quotesReceived: Number(quotesRec?.c ?? 0),
      sharesReceived: Number(sharesRec?.c ?? 0),
      likesGiven: Number(likesGiven?.c ?? 0),
      repostsGiven: Number(repostsGiven?.c ?? 0),
    },
  });
}

export async function handleStorageStatus(_req: Request, env: Env): Promise<Response> {
  if (!env.DB) {
    return jsonNoStore({ ok: false, error: "Relational store unavailable" }, 503);
  }
  const [users, posts, comments, media] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM posts").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM token_comments").first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS bytes FROM media_objects").first<{
      c: number;
      bytes: number;
    }>(),
  ]);

  return jsonNoStore({
    ok: true,
    bindings: {
      relational: env.SOCIAL_DO ? "SQLite Durable Object (Workers Free)" : "Cloudflare D1",
      media: env.MEDIA ? "Cloudflare R2 (MEDIA bucket)" : "SQLite media_objects fallback (R2 optional)",
      cache: env.CACHE ? "Cloudflare KV + Edge Cache API" : "Edge Cache API (KV optional)",
      rpc: env.RPC_URL ? "Keyed RPC + public fallbacks" : "Public Elysium 99901 RPC failover",
    },
    counts: {
      users: Number(users?.c ?? 0),
      posts: Number(posts?.c ?? 0),
      tokenComments: Number(comments?.c ?? 0),
      mediaObjects: Number(media?.c ?? 0),
      mediaBytes: Number(media?.bytes ?? 0),
    },
    quotas: {
      d1OrDoDailyReads: 5_000_000,
      d1OrDoDailyWrites: 100_000,
      r2FreeStorageBytes: 10 * 1024 * 1024 * 1024,
      kvDailyWrites: 1_000,
    },
  });
}
