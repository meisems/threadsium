// Threadsium social API: feed, posts, reactions, reposts, quotes, saved posts, replies, token rooms,
// profiles, follows, search, notifications and direct messages.
// Every personalized response is no-store; every mutation goes through requireMutatingUser
// (session cookie + Origin check + CSRF token) and a server-side rate limit.
import { getSessionUser, jsonNoStore, requireMutatingUser, type AuthUser } from "./auth.ts";
import type { Env, SqlDb } from "./env.ts";
import { deleteMediaByUrl, ownsMediaUrl } from "./media.ts";
import { checkRateLimit } from "./store.ts";

export const REACTION_KINDS = ["like", "bull", "bear", "haha", "eyes"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const LIMITS = { post: 500, reply: 400, message: 1000, page: 20, pageMax: 40 } as const;
const TEN_MIN = 600_000;
const NOTIFICATION_TTL_MS = 12 * 3600_000;

export interface UserLite {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  walletAddress: string | null;
  walletVerified: boolean;
}

interface QuotedPost {
  id: string;
  author: UserLite;
  content: string;
  imageUrl: string | null;
  roomAddress: string | null;
  createdAt: number;
}

export interface ApiPost {
  /** Unique within a feed: the repost row's id for reposts, otherwise the post id. */
  feedId: string;
  id: string;
  author: UserLite;
  content: string;
  imageUrl: string | null;
  roomAddress: string | null;
  tokenRefs: string[];
  createdAt: number;
  sortAt: number;
  editedAt: number | null;
  reactionCount: number;
  replyCount: number;
  repostCount: number;
  shareCount: number;
  reactions: Partial<Record<ReactionKind, number>>;
  viewer: { reaction: ReactionKind | null; reposted: boolean; saved: boolean };
  isQuote: boolean;
  quoted: QuotedPost | null;
  repostedBy: UserLite | null;
}

interface UserCols {
  u_id: string;
  u_username: string;
  u_display_name: string;
  u_avatar_url: string | null;
  u_avatar_preset: string | null;
  u_wallet_address: string | null;
  u_wallet_verified: number;
}

interface PostRow extends UserCols {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  token_refs: string;
  room_address: string | null;
  repost_of_id: string | null;
  is_quote: number;
  like_count: number;
  repost_count: number;
  reply_count: number;
  share_count: number;
  created_at: number;
  updated_at: number | null;
}

const USER_COLS = `u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
  u.avatar_url AS u_avatar_url, u.avatar_preset AS u_avatar_preset,
  u.wallet_address AS u_wallet_address, u.wallet_verified AS u_wallet_verified`;

const POST_SELECT = `SELECT p.id, p.author_id, p.content, p.image_url, p.token_refs, p.room_address,
  p.repost_of_id, p.is_quote, p.like_count, p.repost_count, p.reply_count, p.share_count,
  p.created_at, p.updated_at, ${USER_COLS}
  FROM posts p JOIN users u ON u.id = p.author_id`;

/* ───────────────────────── helpers ───────────────────────── */

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
const unique = <T>(xs: T[]) => [...new Set(xs)];
const isAddress = (s: unknown): s is string => typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

function lite(r: UserCols): UserLite {
  return {
    id: r.u_id,
    username: r.u_username,
    displayName: r.u_display_name || r.u_username,
    avatarUrl: r.u_avatar_url,
    avatarPreset: r.u_avatar_preset,
    walletAddress: r.u_wallet_address,
    walletVerified: !!r.u_wallet_verified,
  };
}

/** Trims, drops control characters, and limits consecutive blank lines. */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** $TICKER (upper-cased), 0x contract addresses (lower-cased) and #hashtags (lower-cased) found in a post. */
export function extractTokenRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const m of content.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)) refs.add(m[1].toUpperCase());
  for (const m of content.matchAll(/\b(0x[a-fA-F0-9]{40})\b/g)) refs.add(m[1].toLowerCase());
  for (const m of content.matchAll(/#([A-Za-z0-9_]{2,32})\b/g)) refs.add(`#${m[1].toLowerCase()}`);
  return [...refs].slice(0, 24);
}

export function extractMentions(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,20})\b/g)) out.add(m[1].toLowerCase());
  return [...out].slice(0, 5);
}

function parseRefs(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function readJson(req: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const bad = (message: string, status = 400) => jsonNoStore({ error: message }, status);
const noDb = () => bad("The database is not available right now. Try again in a moment.", 503);
const limited = (what: string) => bad(`You are ${what} too fast. Wait a few minutes and try again.`, 429);

async function notify(
  db: SqlDb,
  recipientId: string,
  actorId: string,
  type: string,
  message: string,
  link: string,
): Promise<void> {
  if (recipientId === actorId) return;
  await db
    .prepare(
      "INSERT INTO notifications (id, recipient_id, actor_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uid("n"), recipientId, actorId, type, message, link, Date.now())
    .run();
}

async function notifyMentions(db: SqlDb, actor: AuthUser, content: string, link: string, skip: string[] = []) {
  const names = extractMentions(content);
  if (!names.length) return;
  const res = await db
    .prepare(`SELECT id FROM users WHERE LOWER(username) IN (${marks(names.length)})`)
    .bind(...names)
    .all<{ id: string }>();
  for (const u of res.results) {
    if (skip.includes(u.id)) continue;
    await notify(db, u.id, actor.id, "mention", "mentioned you", link);
  }
}

/* ───────────────────────── post hydration ───────────────────────── */

async function hydrate(db: SqlDb, rows: PostRow[], viewer: AuthUser | null): Promise<ApiPost[]> {
  if (!rows.length) return [];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const origIds = unique(rows.map((r) => r.repost_of_id).filter((x): x is string => !!x));
  const origs = new Map<string, PostRow>();
  const missing: string[] = [];
  for (const id of origIds) {
    const r = byId.get(id);
    if (r) origs.set(id, r);
    else missing.push(id);
  }
  for (const part of chunks(missing, 80)) {
    const res = await db
      .prepare(`${POST_SELECT} WHERE p.id IN (${marks(part.length)})`)
      .bind(...part)
      .all<PostRow>();
    for (const r of res.results) origs.set(r.id, r);
  }

  const ids = unique([...rows.filter((r) => !(r.repost_of_id && !r.is_quote)).map((r) => r.id), ...origs.keys()]);
  const kinds = new Map<string, Partial<Record<ReactionKind, number>>>();
  const mine = new Map<string, ReactionKind>();
  const reposted = new Set<string>();
  const saved = new Set<string>();

  for (const part of chunks(ids, 80)) {
    const m = marks(part.length);
    const counts = await db
      .prepare(
        `SELECT target_id, kind, COUNT(*) AS c FROM likes WHERE target_type = 'post' AND target_id IN (${m}) GROUP BY target_id, kind`,
      )
      .bind(...part)
      .all<{ target_id: string; kind: string; c: number }>();
    for (const r of counts.results) {
      const k = (REACTION_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ReactionKind) : "like";
      const cur = kinds.get(r.target_id) ?? {};
      cur[k] = (cur[k] ?? 0) + Number(r.c);
      kinds.set(r.target_id, cur);
    }
    if (!viewer) continue;
    const [a, b, c] = await Promise.all([
      db
        .prepare(`SELECT target_id, kind FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id IN (${m})`)
        .bind(viewer.id, ...part)
        .all<{ target_id: string; kind: string }>(),
      db
        .prepare(`SELECT post_id FROM reposts WHERE user_id = ? AND post_id IN (${m})`)
        .bind(viewer.id, ...part)
        .all<{ post_id: string }>(),
      db
        .prepare(`SELECT post_id FROM bookmarks WHERE user_id = ? AND post_id IN (${m})`)
        .bind(viewer.id, ...part)
        .all<{ post_id: string }>(),
    ]);
    for (const r of a.results) {
      mine.set(r.target_id, (REACTION_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ReactionKind) : "like");
    }
    for (const r of b.results) reposted.add(r.post_id);
    for (const r of c.results) saved.add(r.post_id);
  }

  const build = (r: PostRow): ApiPost => ({
    feedId: r.id,
    id: r.id,
    author: lite(r),
    content: r.content,
    imageUrl: r.image_url,
    roomAddress: r.room_address,
    tokenRefs: parseRefs(r.token_refs),
    createdAt: r.created_at,
    sortAt: r.created_at,
    editedAt: r.updated_at,
    reactionCount: Number(r.like_count || 0),
    replyCount: Number(r.reply_count || 0),
    repostCount: Number(r.repost_count || 0),
    shareCount: Number(r.share_count || 0),
    reactions: kinds.get(r.id) ?? {},
    viewer: { reaction: mine.get(r.id) ?? null, reposted: reposted.has(r.id), saved: saved.has(r.id) },
    isQuote: !!r.is_quote,
    quoted: null,
    repostedBy: null,
  });

  const out: ApiPost[] = [];
  for (const r of rows) {
    if (r.repost_of_id && !r.is_quote) {
      const o = origs.get(r.repost_of_id);
      if (!o) continue;
      out.push({ ...build(o), feedId: r.id, sortAt: r.created_at, repostedBy: lite(r) });
      continue;
    }
    const p = build(r);
    if (r.repost_of_id) {
      const o = origs.get(r.repost_of_id);
      p.quoted = o
        ? {
            id: o.id,
            author: lite(o),
            content: o.content,
            imageUrl: o.image_url,
            roomAddress: o.room_address,
            createdAt: o.created_at,
          }
        : null;
    }
    out.push(p);
  }
  return out;
}

async function loadPost(db: SqlDb, id: string): Promise<PostRow | null> {
  return db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
}

/** Resolves a repost row to the post it points at, so actions always land on the original. */
async function resolveTarget(db: SqlDb, id: string): Promise<PostRow | null> {
  const row = await loadPost(db, id);
  if (row && row.repost_of_id && !row.is_quote) return loadPost(db, row.repost_of_id);
  return row;
}

function pageParams(url: URL): { limit: number; before: number } {
  const limit = Math.min(LIMITS.pageMax, Math.max(1, Number(url.searchParams.get("limit")) || LIMITS.page));
  const b = Number(url.searchParams.get("before"));
  return { limit, before: Number.isFinite(b) && b > 0 ? b : Number.MAX_SAFE_INTEGER };
}

async function page(db: SqlDb, viewer: AuthUser | null, where: string, binds: unknown[], limit: number) {
  const res = await db
    .prepare(`${POST_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<PostRow>();
  const posts = await hydrate(db, res.results, viewer);
  const last = res.results[res.results.length - 1];
  return { posts, nextBefore: res.results.length === limit && last ? last.created_at : null };
}

/* ───────────────────────── feeds and posts ───────────────────────── */

export async function handleListPosts(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const url = new URL(req.url);
  const { limit, before } = pageParams(url);
  const feed = url.searchParams.get("feed");
  const author = url.searchParams.get("author");
  const room = url.searchParams.get("room");
  const tag = url.searchParams.get("tag");

  if (feed === "following") {
    if (!viewer) return bad("Sign in to see posts from people you follow.", 401);
    return jsonNoStore(
      await page(
        env.DB,
        viewer,
        "p.created_at < ? AND (p.author_id = ? OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))",
        [before, viewer.id, viewer.id],
        limit,
      ),
    );
  }
  if (author) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(author)) return bad("That profile does not exist.", 404);
    const media = url.searchParams.get("media") === "1";
    return jsonNoStore(
      await page(
        env.DB,
        viewer,
        `p.created_at < ? AND u.username = ? COLLATE NOCASE${media ? " AND p.image_url IS NOT NULL" : ""}`,
        [before, author],
        limit,
      ),
    );
  }
  if (room) {
    if (!isAddress(room)) return bad("That is not a token contract address.");
    const addr = room.toLowerCase();
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    const hasSymbol = /^[A-Z][A-Z0-9]{0,11}$/.test(symbol);
    const where = `p.created_at < ? AND (p.room_address = ? OR p.token_refs LIKE ?${hasSymbol ? " OR p.token_refs LIKE ?" : ""})`;
    const binds: unknown[] = [before, addr, `%"${addr}"%`];
    if (hasSymbol) binds.push(`%"${symbol}"%`);
    return jsonNoStore(await page(env.DB, viewer, where, binds, limit));
  }
  if (tag) {
    const t = tag.replace(/^#/, "").toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(t)) return bad("That is not a valid hashtag.");
    return jsonNoStore(await page(env.DB, viewer, "p.created_at < ? AND p.token_refs LIKE ?", [before, `%"#${t}"%`], limit));
  }
  return jsonNoStore(await page(env.DB, viewer, "p.created_at < ?", [before], limit));
}

export async function handleGetPost(req: Request, env: Env, postId: string): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);
  const [post] = await hydrate(env.DB, [row], viewer);
  const replies = await listReplies(env.DB, row.id);
  return jsonNoStore({ post, replies });
}

export async function handleCreatePost(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `post:${user.id}`, 25, TEN_MIN))) return limited("posting");

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const content = cleanText(body.content, LIMITS.post);
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null;
  const quoteOfId = typeof body.quoteOfId === "string" && body.quoteOfId ? body.quoteOfId : null;
  const roomAddress = isAddress(body.roomAddress) ? body.roomAddress.toLowerCase() : null;

  if (!content && !imageUrl) return bad("Write something or add an image before posting.");
  if (typeof body.content === "string" && body.content.trim().length > LIMITS.post) {
    return bad(`Posts can be up to ${LIMITS.post} characters.`);
  }
  if (imageUrl && !(await ownsMediaUrl(env, user.id, imageUrl, "posts"))) {
    return bad("That image was not uploaded from your account.");
  }

  let quoted: PostRow | null = null;
  if (quoteOfId) {
    quoted = await resolveTarget(env.DB, quoteOfId);
    if (!quoted) return bad("The post you are quoting was deleted.", 404);
    if (!content) return bad("Add a comment to quote this post, or repost it instead.");
  }

  const id = uid("p");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO posts (id, author_id, content, image_url, token_refs, room_address, repost_of_id, is_quote, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, content, imageUrl, JSON.stringify(extractTokenRefs(content)), roomAddress, quoted?.id ?? null, quoted ? 1 : 0, now)
    .run();

  if (quoted) {
    await env.DB.prepare("UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?").bind(quoted.id).run();
    await notify(env.DB, quoted.author_id, user.id, "quote", "quoted your post", `/app/post/${id}`);
  }
  await notifyMentions(env.DB, user, content, `/app/post/${id}`, quoted ? [quoted.author_id] : []);

  const row = await loadPost(env.DB, id);
  const [post] = await hydrate(env.DB, row ? [row] : [], user);
  return jsonNoStore({ post }, 201);
}

export async function handleUpdatePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const row = await loadPost(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);
  if (row.author_id !== auth.user.id) return bad("You can only edit your own posts.", 403);
  if (row.repost_of_id && !row.is_quote) return bad("Reposts cannot be edited.");

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const content = cleanText(body.content, LIMITS.post);
  if (!content && !row.image_url) return bad("A post cannot be empty.");

  await env.DB.prepare("UPDATE posts SET content = ?, token_refs = ?, updated_at = ? WHERE id = ?")
    .bind(content, JSON.stringify(extractTokenRefs(content)), Date.now(), postId)
    .run();
  const fresh = await loadPost(env.DB, postId);
  const [post] = await hydrate(env.DB, fresh ? [fresh] : [], auth.user);
  return jsonNoStore({ post });
}

export async function handleDeletePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const row = await loadPost(env.DB, postId);
  if (!row) return jsonNoStore({ ok: true });
  if (row.author_id !== auth.user.id) return bad("You can only delete your own posts.", 403);

  const stmts = [
    env.DB.prepare("DELETE FROM likes WHERE target_type = 'post' AND target_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM post_replies WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM reposts WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM bookmarks WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM post_shares WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM posts WHERE repost_of_id = ? AND is_quote = 0").bind(postId),
    env.DB.prepare("UPDATE users SET pinned_post_id = NULL WHERE pinned_post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(postId),
  ];
  if (row.repost_of_id) {
    stmts.push(
      env.DB.prepare("UPDATE posts SET repost_count = MAX(0, repost_count - 1) WHERE id = ?").bind(row.repost_of_id),
    );
    if (!row.is_quote) {
      stmts.push(env.DB.prepare("DELETE FROM reposts WHERE user_id = ? AND post_id = ?").bind(auth.user.id, row.repost_of_id));
    }
  }
  await env.DB.batch(stmts);
  if (row.image_url) await deleteMediaByUrl(env, auth.user.id, row.image_url);
  return jsonNoStore({ ok: true });
}

/* ───────────────────────── reactions, reposts, saves, shares, pin ───────────────────────── */

export async function handleReact(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `react:${user.id}`, 120, TEN_MIN))) return limited("reacting");

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const kind = body.kind === null ? null : String(body.kind || "");
  if (kind !== null && !(REACTION_KINDS as readonly string[]).includes(kind)) return bad("Unknown reaction.");

  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);

  const existing = await env.DB.prepare(
    "SELECT id, kind FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?",
  )
    .bind(user.id, row.id)
    .first<{ id: string; kind: string }>();

  if (kind === null) {
    if (existing) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM likes WHERE id = ?").bind(existing.id),
        env.DB.prepare("UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(row.id),
      ]);
    }
  } else if (existing) {
    if (existing.kind !== kind) await env.DB.prepare("UPDATE likes SET kind = ? WHERE id = ?").bind(kind, existing.id).run();
  } else {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO likes (id, user_id, target_type, target_id, kind, created_at) VALUES (?, ?, 'post', ?, ?, ?)",
      ).bind(uid("l"), user.id, row.id, kind, Date.now()),
      env.DB.prepare(
        "UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE target_type = 'post' AND target_id = ?) WHERE id = ?",
      ).bind(row.id, row.id),
    ]);
    await notify(env.DB, row.author_id, user.id, "reaction", "reacted to your post", `/app/post/${row.id}`);
  }

  const counts = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS c FROM likes WHERE target_type = 'post' AND target_id = ? GROUP BY kind",
  )
    .bind(row.id)
    .all<{ kind: string; c: number }>();
  const reactions: Partial<Record<ReactionKind, number>> = {};
  let total = 0;
  for (const r of counts.results) {
    const k = (REACTION_KINDS as readonly string[]).includes(r.kind) ? (r.kind as ReactionKind) : "like";
    reactions[k] = (reactions[k] ?? 0) + Number(r.c);
    total += Number(r.c);
  }
  return jsonNoStore({ reaction: kind, reactions, reactionCount: total });
}

export async function handleRepost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `repost:${user.id}`, 40, TEN_MIN))) return limited("reposting");

  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);

  const existing = await env.DB.prepare("SELECT id FROM reposts WHERE user_id = ? AND post_id = ?")
    .bind(user.id, row.id)
    .first<{ id: string }>();

  if (existing) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reposts WHERE id = ?").bind(existing.id),
      env.DB.prepare("DELETE FROM posts WHERE author_id = ? AND repost_of_id = ? AND is_quote = 0").bind(user.id, row.id),
      env.DB.prepare("UPDATE posts SET repost_count = MAX(0, repost_count - 1) WHERE id = ?").bind(row.id),
    ]);
  } else {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO reposts (id, user_id, post_id, created_at) VALUES (?, ?, ?, ?)").bind(
        uid("r"),
        user.id,
        row.id,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO posts (id, author_id, content, token_refs, repost_of_id, is_quote, created_at) VALUES (?, ?, '', '[]', ?, 0, ?)",
      ).bind(uid("p"), user.id, row.id, now),
      env.DB.prepare("UPDATE posts SET repost_count = repost_count + 1 WHERE id = ?").bind(row.id),
    ]);
    await notify(env.DB, row.author_id, user.id, "repost", "reposted your post", `/app/post/${row.id}`);
  }
  const fresh = await env.DB.prepare("SELECT repost_count FROM posts WHERE id = ?").bind(row.id).first<{ repost_count: number }>();
  return jsonNoStore({ reposted: !existing, repostCount: Number(fresh?.repost_count ?? 0) });
}

export async function handleSave(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);
  const existing = await env.DB.prepare("SELECT 1 AS x FROM bookmarks WHERE user_id = ? AND post_id = ?")
    .bind(auth.user.id, row.id)
    .first<{ x: number }>();
  if (existing) {
    await env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?").bind(auth.user.id, row.id).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)")
      .bind(auth.user.id, row.id, Date.now())
      .run();
  }
  return jsonNoStore({ saved: !existing });
}

export async function handleListSaved(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  if (!viewer) return bad("Sign in to see your saved posts.", 401);
  const { limit, before } = pageParams(new URL(req.url));
  const res = await env.DB.prepare(
    `SELECT b.created_at AS saved_at, b.post_id FROM bookmarks b WHERE b.user_id = ? AND b.created_at < ? ORDER BY b.created_at DESC LIMIT ?`,
  )
    .bind(viewer.id, before, limit)
    .all<{ saved_at: number; post_id: string }>();
  const ids = res.results.map((r) => r.post_id);
  let rows: PostRow[] = [];
  if (ids.length) {
    const got = await env.DB.prepare(`${POST_SELECT} WHERE p.id IN (${marks(ids.length)})`)
      .bind(...ids)
      .all<PostRow>();
    const map = new Map(got.results.map((r) => [r.id, r]));
    rows = ids.map((id) => map.get(id)).filter((r): r is PostRow => !!r);
  }
  const last = res.results[res.results.length - 1];
  return jsonNoStore({
    posts: await hydrate(env.DB, rows, viewer),
    nextBefore: res.results.length === limit && last ? last.saved_at : null,
  });
}

export async function handleSharePost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  if (!(await checkRateLimit(env.DB, `share:${auth.user.id}`, 60, TEN_MIN))) return limited("sharing");
  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO post_shares (id, user_id, post_id, created_at) VALUES (?, ?, ?, ?)").bind(
      uid("s"),
      auth.user.id,
      row.id,
      Date.now(),
    ),
    env.DB.prepare("UPDATE posts SET share_count = share_count + 1 WHERE id = ?").bind(row.id),
  ]);
  return jsonNoStore({ shareCount: Number(row.share_count || 0) + 1 });
}

export async function handlePinPost(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const row = await loadPost(env.DB, postId);
  if (!row || row.author_id !== auth.user.id || (row.repost_of_id && !row.is_quote)) {
    return bad("You can only pin your own posts.", 403);
  }
  const next = auth.user.pinnedPostId === postId ? null : postId;
  await env.DB.prepare("UPDATE users SET pinned_post_id = ? WHERE id = ?").bind(next, auth.user.id).run();
  return jsonNoStore({ pinnedPostId: next });
}

/* ───────────────────────── replies ───────────────────────── */

interface ReplyRow extends UserCols {
  id: string;
  post_id: string;
  parent_reply_id: string | null;
  content: string;
  created_at: number;
  updated_at: number | null;
}

function mapReply(r: ReplyRow) {
  return {
    id: r.id,
    postId: r.post_id,
    parentReplyId: r.parent_reply_id,
    author: lite(r),
    content: r.content,
    createdAt: r.created_at,
    editedAt: r.updated_at,
  };
}

async function listReplies(db: SqlDb, postId: string) {
  const res = await db
    .prepare(
      `SELECT r.id, r.post_id, r.parent_reply_id, r.content, r.created_at, r.updated_at, ${USER_COLS}
       FROM post_replies r JOIN users u ON u.id = r.author_id
       WHERE r.post_id = ? ORDER BY r.created_at ASC LIMIT 200`,
    )
    .bind(postId)
    .all<ReplyRow>();
  return res.results.map(mapReply);
}

export async function handleCreateReply(req: Request, env: Env, postId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `reply:${user.id}`, 40, TEN_MIN))) return limited("replying");

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const content = cleanText(body.content, LIMITS.reply);
  if (!content) return bad("Write a reply first.");

  const row = await resolveTarget(env.DB, postId);
  if (!row) return bad("This post was deleted or never existed.", 404);

  let parentId: string | null = null;
  let parentAuthor: string | null = null;
  if (typeof body.parentReplyId === "string" && body.parentReplyId) {
    const parent = await env.DB.prepare("SELECT id, post_id, author_id, parent_reply_id FROM post_replies WHERE id = ?")
      .bind(body.parentReplyId)
      .first<{ id: string; post_id: string; author_id: string; parent_reply_id: string | null }>();
    if (!parent || parent.post_id !== row.id) return bad("The reply you are answering was deleted.", 404);
    // Two levels only: answers to a nested reply attach to its top-level parent.
    parentId = parent.parent_reply_id ?? parent.id;
    parentAuthor = parent.author_id;
  }

  const id = uid("c");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO post_replies (id, post_id, author_id, parent_reply_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, row.id, user.id, parentId, content, Date.now()),
    env.DB.prepare("UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?").bind(row.id),
  ]);

  const link = `/app/post/${row.id}`;
  await notify(env.DB, row.author_id, user.id, "reply", "replied to your post", link);
  if (parentAuthor && parentAuthor !== row.author_id) {
    await notify(env.DB, parentAuthor, user.id, "reply", "answered your reply", link);
  }
  await notifyMentions(env.DB, user, content, link, [row.author_id, parentAuthor ?? ""]);

  const fresh = await env.DB.prepare(
    `SELECT r.id, r.post_id, r.parent_reply_id, r.content, r.created_at, r.updated_at, ${USER_COLS}
     FROM post_replies r JOIN users u ON u.id = r.author_id WHERE r.id = ?`,
  )
    .bind(id)
    .first<ReplyRow>();
  return jsonNoStore({ reply: fresh ? mapReply(fresh) : null, replyCount: Number(row.reply_count || 0) + 1 }, 201);
}

export async function handleModifyReply(req: Request, env: Env, replyId: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const reply = await env.DB.prepare("SELECT id, post_id, author_id FROM post_replies WHERE id = ?")
    .bind(replyId)
    .first<{ id: string; post_id: string; author_id: string }>();
  if (!reply) return bad("This reply was deleted or never existed.", 404);
  if (reply.author_id !== auth.user.id) return bad("You can only change your own replies.", 403);

  if (req.method === "DELETE") {
    const children = await env.DB.prepare("SELECT COUNT(*) AS c FROM post_replies WHERE parent_reply_id = ?")
      .bind(replyId)
      .first<{ c: number }>();
    const removed = 1 + Number(children?.c ?? 0);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM post_replies WHERE parent_reply_id = ?").bind(replyId),
      env.DB.prepare("DELETE FROM post_replies WHERE id = ?").bind(replyId),
      env.DB.prepare("UPDATE posts SET reply_count = MAX(0, reply_count - ?) WHERE id = ?").bind(removed, reply.post_id),
    ]);
    return jsonNoStore({ ok: true, removed });
  }

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const content = cleanText(body.content, LIMITS.reply);
  if (!content) return bad("A reply cannot be empty.");
  const now = Date.now();
  await env.DB.prepare("UPDATE post_replies SET content = ?, updated_at = ? WHERE id = ?").bind(content, now, replyId).run();
  return jsonNoStore({ ok: true, content, editedAt: now });
}

/* ───────────────────────── token rooms ───────────────────────── */

async function roomStats(db: SqlDb, addr: string, viewer: AuthUser | null) {
  const [votes, posts, mine] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN sentiment = 'bullish' THEN 1 ELSE 0 END) AS bullish,
           SUM(CASE WHEN sentiment = 'bearish' THEN 1 ELSE 0 END) AS bearish,
           AVG(rating) AS avg_rating,
           COUNT(rating) AS rating_count,
           COUNT(*) AS voters
         FROM token_votes WHERE token_address = ?`,
      )
      .bind(addr)
      .first<{ bullish: number | null; bearish: number | null; avg_rating: number | null; rating_count: number; voters: number }>(),
    db.prepare("SELECT COUNT(*) AS c FROM posts WHERE room_address = ?").bind(addr).first<{ c: number }>(),
    viewer
      ? db
          .prepare("SELECT rating, sentiment FROM token_votes WHERE user_id = ? AND token_address = ?")
          .bind(viewer.id, addr)
          .first<{ rating: number | null; sentiment: string | null }>()
      : Promise.resolve(null),
  ]);
  return {
    address: addr,
    bullish: Number(votes?.bullish ?? 0),
    bearish: Number(votes?.bearish ?? 0),
    avgRating: votes?.avg_rating ? Math.round(Number(votes.avg_rating) * 10) / 10 : 0,
    ratingCount: Number(votes?.rating_count ?? 0),
    voters: Number(votes?.voters ?? 0),
    postCount: Number(posts?.c ?? 0),
    myRating: mine?.rating ?? null,
    mySentiment: (mine?.sentiment as "bullish" | "bearish" | null) ?? null,
  };
}

export async function handleRoom(req: Request, env: Env, rawAddress: string): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  return jsonNoStore({ room: await roomStats(env.DB, rawAddress.toLowerCase(), viewer) });
}

export async function handleRoomVote(req: Request, env: Env, rawAddress: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `vote:${user.id}`, 60, TEN_MIN))) return limited("voting");
  const addr = rawAddress.toLowerCase();

  const body = await readJson(req);
  if (!body) return bad("The request could not be read.");
  const cur = await env.DB.prepare("SELECT rating, sentiment FROM token_votes WHERE user_id = ? AND token_address = ?")
    .bind(user.id, addr)
    .first<{ rating: number | null; sentiment: string | null }>();

  let rating = cur?.rating ?? null;
  let sentiment = cur?.sentiment ?? null;
  if ("rating" in body) {
    if (body.rating === null) rating = null;
    else {
      const n = Number(body.rating);
      if (!Number.isInteger(n) || n < 1 || n > 5) return bad("Ratings go from 1 to 5.");
      rating = n;
    }
  }
  if ("sentiment" in body) {
    if (body.sentiment === null) sentiment = null;
    else if (body.sentiment === "bullish" || body.sentiment === "bearish") sentiment = body.sentiment;
    else return bad("Sentiment is either bullish or bearish.");
  }

  if (rating === null && sentiment === null) {
    await env.DB.prepare("DELETE FROM token_votes WHERE user_id = ? AND token_address = ?").bind(user.id, addr).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO token_votes (user_id, token_address, rating, sentiment, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, token_address) DO UPDATE SET rating = excluded.rating, sentiment = excluded.sentiment, updated_at = excluded.updated_at`,
    )
      .bind(user.id, addr, rating, sentiment, Date.now())
      .run();
  }
  return jsonNoStore({ room: await roomStats(env.DB, addr, user) });
}

/* ───────────────────────── profiles and follows ───────────────────────── */

interface ProfileRow {
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
}

const PROFILE_COLS =
  "id, username, display_name, bio, avatar_url, avatar_preset, banner_url, wallet_address, wallet_verified, show_connections, pinned_post_id, created_at";

async function findProfile(db: SqlDb, username: string): Promise<ProfileRow | null> {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return null;
  return db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE username = ? COLLATE NOCASE`).bind(username).first<ProfileRow>();
}

function profileLite(r: ProfileRow): UserLite & { bio: string } {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name || r.username,
    avatarUrl: r.avatar_url,
    avatarPreset: r.avatar_preset,
    walletAddress: r.wallet_address,
    walletVerified: !!r.wallet_verified,
    bio: r.bio || "",
  };
}

export async function handleGetProfile(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const p = await findProfile(env.DB, username);
  if (!p) return bad("That profile does not exist.", 404);

  const [followers, following, posts, iFollow, followsMe] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?").bind(p.id).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?").bind(p.id).first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND (repost_of_id IS NULL OR is_quote = 1)")
      .bind(p.id)
      .first<{ c: number }>(),
    viewer
      ? env.DB.prepare("SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?").bind(viewer.id, p.id).first<{ x: number }>()
      : Promise.resolve(null),
    viewer
      ? env.DB.prepare("SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?").bind(p.id, viewer.id).first<{ x: number }>()
      : Promise.resolve(null),
  ]);

  let pinnedPost: ApiPost | null = null;
  if (p.pinned_post_id) {
    const row = await loadPost(env.DB, p.pinned_post_id);
    if (row) [pinnedPost] = await hydrate(env.DB, [row], viewer);
  }

  const isSelf = viewer?.id === p.id;
  return jsonNoStore({
    profile: {
      ...profileLite(p),
      bannerUrl: p.banner_url,
      createdAt: p.created_at,
      showConnections: p.show_connections !== 0,
      pinnedPostId: p.pinned_post_id,
      isSystem: p.id === "u_elysium_desk",
    },
    counts: {
      followers: Number(followers?.c ?? 0),
      following: Number(following?.c ?? 0),
      posts: Number(posts?.c ?? 0),
    },
    viewer: { isSelf, following: !!iFollow, followsYou: !!followsMe },
    pinnedPost,
  });
}

export async function handleProfileReplies(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return noDb();
  const p = await findProfile(env.DB, username);
  if (!p) return bad("That profile does not exist.", 404);
  const res = await env.DB.prepare(
    `SELECT r.id, r.post_id, r.parent_reply_id, r.content, r.created_at, r.updated_at, ${USER_COLS},
            SUBSTR(op.content, 1, 120) AS post_snippet, ou.username AS post_author
     FROM post_replies r
     JOIN users u ON u.id = r.author_id
     JOIN posts op ON op.id = r.post_id
     JOIN users ou ON ou.id = op.author_id
     WHERE r.author_id = ? ORDER BY r.created_at DESC LIMIT 40`,
  )
    .bind(p.id)
    .all<ReplyRow & { post_snippet: string; post_author: string }>();
  return jsonNoStore({
    replies: res.results.map((r) => ({ ...mapReply(r), postSnippet: r.post_snippet || "", postAuthor: r.post_author })),
  });
}

export async function handleToggleFollow(req: Request, env: Env, username: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `follow:${user.id}`, 60, TEN_MIN))) return limited("following people");
  const p = await findProfile(env.DB, username);
  if (!p) return bad("That profile does not exist.", 404);
  if (p.id === user.id) return bad("You cannot follow yourself.");

  const existing = await env.DB.prepare("SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ?")
    .bind(user.id, p.id)
    .first<{ x: number }>();
  if (existing) {
    await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").bind(user.id, p.id).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)")
      .bind(user.id, p.id, Date.now())
      .run();
    await notify(env.DB, p.id, user.id, "follow", "followed you", `/app/u/${user.username}`);
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?").bind(p.id).first<{ c: number }>();
  return jsonNoStore({ following: !existing, followers: Number(count?.c ?? 0) });
}

export async function handleGetConnections(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const p = await findProfile(env.DB, username);
  if (!p) return bad("That profile does not exist.", 404);
  if (p.show_connections === 0 && viewer?.id !== p.id) return jsonNoStore({ hidden: true, people: [] });

  const tab = new URL(req.url).searchParams.get("tab") === "following" ? "following" : "followers";
  const sql =
    tab === "followers"
      ? `SELECT ${PROFILE_COLS.split(", ").map((c) => `u.${c}`).join(", ")} FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 100`
      : `SELECT ${PROFILE_COLS.split(", ").map((c) => `u.${c}`).join(", ")} FROM follows f JOIN users u ON u.id = f.following_id
         WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 100`;
  const res = await env.DB.prepare(sql).bind(p.id).all<ProfileRow>();
  return jsonNoStore({ hidden: false, people: res.results.map(profileLite) });
}

/* ───────────────────────── search and discovery ───────────────────────── */

export async function handleSearch(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const ipKey = viewer ? `search:${viewer.id}` : `search:${req.headers.get("cf-connecting-ip") || "anon"}`;
  if (!(await checkRateLimit(env.DB, ipKey, 60, 60_000))) return limited("searching");

  const q = cleanText(new URL(req.url).searchParams.get("q"), 64);
  if (q.length < 2) return jsonNoStore({ users: [], posts: [] });

  if (q.startsWith("#") && /^#[A-Za-z0-9_]{2,32}$/.test(q)) {
    const res = await page(env.DB, viewer, "p.created_at < ? AND p.token_refs LIKE ?", [Number.MAX_SAFE_INTEGER, `%"${q.toLowerCase()}"%`], 30);
    return jsonNoStore({ users: [], posts: res.posts });
  }

  const needle = `%${likeEscape(q.replace(/^@/, "").toLowerCase())}%`;
  const [users, posts] = await Promise.all([
    env.DB.prepare(
      `SELECT ${PROFILE_COLS} FROM users
       WHERE LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(display_name) LIKE ? ESCAPE '\\'
       ORDER BY username ASC LIMIT 12`,
    )
      .bind(needle, needle)
      .all<ProfileRow>(),
    env.DB.prepare(
      `${POST_SELECT} WHERE LOWER(p.content) LIKE ? ESCAPE '\\' AND (p.repost_of_id IS NULL OR p.is_quote = 1)
       ORDER BY p.created_at DESC LIMIT 30`,
    )
      .bind(needle)
      .all<PostRow>(),
  ]);
  return jsonNoStore({ users: users.results.map(profileLite), posts: await hydrate(env.DB, posts.results, viewer) });
}

/** Right-rail data: people worth following and the hashtags used most over the last week. */
export async function handleDiscover(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  const me = viewer?.id ?? "";
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const [people, recent] = await Promise.all([
    env.DB.prepare(
      `SELECT ${PROFILE_COLS.split(", ").map((c) => `u.${c}`).join(", ")},
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers
       FROM users u
       WHERE u.id <> ? AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, u.created_at DESC LIMIT 5`,
    )
      .bind(me, me)
      .all<ProfileRow & { followers: number }>(),
    env.DB.prepare("SELECT token_refs FROM posts WHERE created_at > ? AND token_refs <> '[]' ORDER BY created_at DESC LIMIT 300")
      .bind(weekAgo)
      .all<{ token_refs: string }>(),
  ]);
  const tagCounts = new Map<string, number>();
  for (const r of recent.results) {
    for (const ref of parseRefs(r.token_refs)) {
      if (ref.startsWith("#")) tagCounts.set(ref, (tagCounts.get(ref) ?? 0) + 1);
    }
  }
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([tag, posts]) => ({ tag, posts }));
  return jsonNoStore({
    people: people.results.map((r) => ({ ...profileLite(r), followers: Number(r.followers || 0) })),
    tags,
  });
}

/* ───────────────────────── notifications ───────────────────────── */

export async function handleNotifications(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  if (req.method === "POST") {
    const auth = await requireMutatingUser(req, env);
    if ("error" in auth) return auth.error;
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL")
      .bind(Date.now(), auth.user.id)
      .run();
    return jsonNoStore({ ok: true });
  }
  const viewer = await getSessionUser(req, env);
  if (!viewer) return bad("Sign in to see your notifications.", 401);
  const res = await env.DB.prepare(
    `SELECT n.id, n.type, n.message, n.link, n.read_at, n.created_at, n.actor_id,
            u.username AS a_username, u.display_name AS a_display_name, u.avatar_url AS a_avatar_url,
            u.avatar_preset AS a_avatar_preset, u.wallet_address AS a_wallet_address, u.wallet_verified AS a_wallet_verified
     FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.recipient_id = ? AND n.created_at >= ? ORDER BY n.created_at DESC LIMIT 60`,
  )
    .bind(viewer.id, Date.now() - NOTIFICATION_TTL_MS)
    .all<{
      id: string;
      type: string;
      message: string;
      link: string | null;
      read_at: number | null;
      created_at: number;
      actor_id: string | null;
      a_username: string | null;
      a_display_name: string | null;
      a_avatar_url: string | null;
      a_avatar_preset: string | null;
      a_wallet_address: string | null;
      a_wallet_verified: number | null;
    }>();
  return jsonNoStore({
    retentionHours: 12,
    notifications: res.results.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      link: n.link && n.link.startsWith("/") ? n.link : null,
      readAt: n.read_at,
      createdAt: n.created_at,
      actor: n.a_username
        ? {
            id: n.actor_id!,
            username: n.a_username,
            displayName: n.a_display_name || n.a_username,
            avatarUrl: n.a_avatar_url,
            avatarPreset: n.a_avatar_preset,
            walletAddress: n.a_wallet_address,
            walletVerified: !!n.a_wallet_verified,
          }
        : null,
    })),
  });
}

/** Unread badges for the navigation. Polled while the tab is visible. */
export async function handleCounts(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  if (!viewer) return jsonNoStore({ notifications: 0, messages: 0 });
  const [n, m] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = ? AND read_at IS NULL AND created_at >= ?")
      .bind(viewer.id, Date.now() - NOTIFICATION_TTL_MS)
      .first<{ c: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM messages WHERE recipient_id = ? AND read_at IS NULL").bind(viewer.id).first<{ c: number }>(),
  ]);
  return jsonNoStore({ notifications: Number(n?.c ?? 0), messages: Number(m?.c ?? 0) });
}

/* ───────────────────────── direct messages ───────────────────────── */

interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read_at: number | null;
  created_at: number;
}

const mapMessage = (m: MessageRow) => ({
  id: m.id,
  senderId: m.sender_id,
  recipientId: m.recipient_id,
  content: m.content,
  readAt: m.read_at,
  createdAt: m.created_at,
});

export async function handleThreads(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  if (!viewer) return bad("Sign in to see your messages.", 401);

  const [recent, unread] = await Promise.all([
    env.DB.prepare(
      "SELECT id, sender_id, recipient_id, content, read_at, created_at FROM messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at DESC LIMIT 300",
    )
      .bind(viewer.id, viewer.id)
      .all<MessageRow>(),
    env.DB.prepare("SELECT sender_id, COUNT(*) AS c FROM messages WHERE recipient_id = ? AND read_at IS NULL GROUP BY sender_id")
      .bind(viewer.id)
      .all<{ sender_id: string; c: number }>(),
  ]);

  const lastByPeer = new Map<string, MessageRow>();
  for (const m of recent.results) {
    const peer = m.sender_id === viewer.id ? m.recipient_id : m.sender_id;
    if (!lastByPeer.has(peer)) lastByPeer.set(peer, m);
  }
  const peerIds = [...lastByPeer.keys()].slice(0, 60);
  const peers = new Map<string, ProfileRow>();
  if (peerIds.length) {
    const res = await env.DB.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE id IN (${marks(peerIds.length)})`)
      .bind(...peerIds)
      .all<ProfileRow>();
    for (const r of res.results) peers.set(r.id, r);
  }
  const unreadBy = new Map(unread.results.map((r) => [r.sender_id, Number(r.c)]));
  return jsonNoStore({
    threads: peerIds
      .filter((id) => peers.has(id))
      .map((id) => ({
        peer: profileLite(peers.get(id)!),
        last: mapMessage(lastByPeer.get(id)!),
        unread: unreadBy.get(id) ?? 0,
      })),
  });
}

export async function handleConversation(req: Request, env: Env, username: string): Promise<Response> {
  if (!env.DB) return noDb();
  const p = await findProfile(env.DB, username);

  if (req.method === "POST") {
    const auth = await requireMutatingUser(req, env);
    if ("error" in auth) return auth.error;
    const user = auth.user;
    if (!p) return bad("That profile does not exist.", 404);
    if (p.id === user.id) return bad("You cannot message yourself.");
    if (p.id === "u_elysium_desk") return bad("The system account does not read messages.");
    if (!(await checkRateLimit(env.DB, `msg:${user.id}`, 40, TEN_MIN))) return limited("sending messages");
    const body = await readJson(req);
    if (!body) return bad("The request could not be read.");
    const content = cleanText(body.content, LIMITS.message);
    if (!content) return bad("Write a message first.");
    const row: MessageRow = {
      id: uid("m"),
      sender_id: user.id,
      recipient_id: p.id,
      content,
      read_at: null,
      created_at: Date.now(),
    };
    await env.DB.prepare("INSERT INTO messages (id, sender_id, recipient_id, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(row.id, row.sender_id, row.recipient_id, row.content, row.created_at)
      .run();
    return jsonNoStore({ message: mapMessage(row) }, 201);
  }

  const viewer = await getSessionUser(req, env);
  if (!viewer) return bad("Sign in to see your messages.", 401);
  if (!p) return bad("That profile does not exist.", 404);
  const res = await env.DB.prepare(
    `SELECT id, sender_id, recipient_id, content, read_at, created_at FROM messages
     WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
     ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(viewer.id, p.id, p.id, viewer.id)
    .all<MessageRow>();
  return jsonNoStore({ peer: profileLite(p), messages: res.results.reverse().map(mapMessage) });
}

export async function handleConversationRead(req: Request, env: Env, username: string): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return noDb();
  const p = await findProfile(env.DB, username);
  if (!p) return bad("That profile does not exist.", 404);
  await env.DB.prepare("UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL")
    .bind(Date.now(), auth.user.id, p.id)
    .run();
  return jsonNoStore({ ok: true });
}

/* ───────────────────────── insights and status ───────────────────────── */

export async function handleMyInsights(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return noDb();
  const viewer = await getSessionUser(req, env);
  if (!viewer) return bad("Sign in to see your insights.", 401);
  const one = (sql: string) => env.DB!.prepare(sql).bind(viewer.id).first<{ c: number | null }>();
  const [posts, reactions, reposts, replies, shares, followers, following] = await Promise.all([
    one("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND (repost_of_id IS NULL OR is_quote = 1)"),
    one("SELECT SUM(like_count) AS c FROM posts WHERE author_id = ?"),
    one("SELECT SUM(repost_count) AS c FROM posts WHERE author_id = ?"),
    one("SELECT SUM(reply_count) AS c FROM posts WHERE author_id = ?"),
    one("SELECT SUM(share_count) AS c FROM posts WHERE author_id = ?"),
    one("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?"),
    one("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?"),
  ]);
  const n = (r: { c: number | null } | null) => Number(r?.c ?? 0);
  return jsonNoStore({
    insights: {
      posts: n(posts),
      reactionsReceived: n(reactions),
      repostsReceived: n(reposts),
      repliesReceived: n(replies),
      sharesReceived: n(shares),
      followers: n(followers),
      following: n(following),
    },
  });
}

/** Public, aggregate-only storage and binding status (no user data). */
export async function handleStatus(_req: Request, env: Env): Promise<Response> {
  let users = 0;
  let posts = 0;
  let mediaObjects = 0;
  let mediaBytes = 0;
  if (env.DB) {
    const [u, p, m] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS c FROM users").first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM posts").first<{ c: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS c, SUM(size_bytes) AS b FROM media_objects").first<{ c: number; b: number | null }>(),
    ]);
    users = Number(u?.c ?? 0);
    posts = Number(p?.c ?? 0);
    mediaObjects = Number(m?.c ?? 0);
    mediaBytes = Number(m?.b ?? 0);
  }
  return new Response(
    JSON.stringify({
      ok: !!env.DB,
      storage: {
        relational: env.SOCIAL_DO ? "SQLite Durable Object" : env.DB ? "D1" : "unavailable",
        media: env.MEDIA ? "R2" : "SQLite (small images only)",
        cache: env.CACHE ? "KV + edge cache" : "edge cache",
      },
      counts: { users, posts, mediaObjects, mediaBytes },
      limits: { postChars: LIMITS.post, replyChars: LIMITS.reply, messageChars: LIMITS.message, notificationHours: 12 },
    }),
    { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } },
  );
}
