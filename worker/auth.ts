// Accounts, sessions, CSRF protection, profile settings, wallet linking and account deletion.
// Passwords: PBKDF2-SHA-256, 100,000 iterations (the Workers runtime ceiling), per-user random salt.
// Sessions: random 256-bit id in an HttpOnly, SameSite=Lax cookie (Secure on HTTPS); only its SHA-256 is stored.
import { verifyMessage, type Hex } from "viem";
import type { Env } from "./env.ts";
import { deleteMediaByUrl, ownsMediaUrl } from "./media.ts";
import { originAllowed } from "./proxy.ts";
import { checkRateLimit } from "./store.ts";

const COOKIE_NAME = "threadsium_sid";
const SESSION_TTL_MS = 14 * 24 * 3600_000;
const PBKDF2_ITERATIONS = 100_000;
const WALLET_CHALLENGE_TTL_MS = 10 * 60_000;
export const PASSWORD_MIN = 8;
export const AVATAR_PRESETS = ["saffron", "iris", "meadow", "ember", "tide", "dusk"] as const;

export interface AuthUser {
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
  csrfToken: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomHex(byteLength = 32): string {
  const b = new Uint8Array(byteLength);
  crypto.getRandomValues(b);
  return toHex(b);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(buf));
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex) as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function clientIpHash(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  return sha256Hex(`ip:${ip}`);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+([0-9a-fA-F]{64,128})$/);
  return m ? m[1] : null;
}

function buildCookieHeader(req: Request, value: string, maxAgeSec: number, embed = false): string {
  const https = new URL(req.url).protocol === "https:";
  const sameSite = embed && https ? "SameSite=None" : "SameSite=Lax";
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", sameSite, `Max-Age=${maxAgeSec}`];
  if (https) parts.push("Secure");
  if (embed && https) parts.push("Partitioned");
  return parts.join("; ");
}

function rowToAuthUser(u: UserRow, csrfToken: string): AuthUser {
  return {
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
    createdAt: u.created_at,
    csrfToken,
  };
}

/** JSON that no browser, CDN or framework cache may store. Used for everything personalized. */
export function jsonNoStore(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "cdn-cache-control": "no-store",
      vary: "Cookie, Authorization, Origin",
      ...extraHeaders,
    },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") || "0") > 8 * 1024) return null;
  try {
    const text = await req.text();
    if (text.length > 8 * 1024) return null;
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Resolves the session from Authorization: Bearer <token> (for cross-site embeds) or the HttpOnly cookie. */
export async function getSessionUser(req: Request, env: Env): Promise<AuthUser | null> {
  if (!env.DB) return null;
  const sid = readBearerToken(req) || readCookie(req, COOKIE_NAME);
  if (!sid || sid.length < 32) return null;
  const tokenHash = await sha256Hex(sid);
  const row = await env.DB.prepare(
    `SELECT s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<UserRow & { csrf_token: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return rowToAuthUser(row, row.csrf_token);
}

/** Session + (same-origin OR explicit Bearer token) + CSRF token. Required by every state-changing request. */
export async function requireMutatingUser(req: Request, env: Env): Promise<{ user: AuthUser } | { error: Response }> {
  const hasBearer = !!readBearerToken(req);
  if (!hasBearer && !originAllowed(req, env)) {
    return { error: jsonNoStore({ error: "This request came from another site and was refused." }, 403) };
  }
  const user = await getSessionUser(req, env);
  if (!user) return { error: jsonNoStore({ error: "Sign in to do that." }, 401) };
  const csrf = req.headers.get("x-csrf-token");
  if (!csrf || !constantTimeEqual(csrf, user.csrfToken)) {
    return { error: jsonNoStore({ error: "Your session needs a refresh. Reload the page and try again." }, 403) };
  }
  return { user };
}

async function startSession(
  req: Request,
  env: Env,
  userId: string,
  ipHash: string,
  embed = false,
): Promise<{ cookie: string; csrfToken: string; sessionToken: string }> {
  const now = Date.now();
  const sessionToken = randomHex(32);
  const csrfToken = randomHex(24);
  await env
    .DB!.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(sessionToken), userId, csrfToken, now + SESSION_TTL_MS, now, ipHash)
    .run();
  return { cookie: buildCookieHeader(req, sessionToken, Math.floor(SESSION_TTL_MS / 1000), embed), csrfToken, sessionToken };
}

export async function handleAuthMe(req: Request, env: Env): Promise<Response> {
  return jsonNoStore({ user: await getSessionUser(req, env) });
}

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const body = await readBody(req);
  if (!body) return jsonNoStore({ error: "The request could not be read." }, 400);
  const embed = body.embed === true;
  if (!embed && !originAllowed(req, env)) {
    return jsonNoStore({ error: "This request came from another site and was refused." }, 403);
  }
  const ipHash = await clientIpHash(req);
  if (!(await checkRateLimit(env.DB, `reg:${ipHash}`, 8, 600_000))) {
    return jsonNoStore({ error: "Too many new accounts from this connection. Wait a few minutes." }, 429);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const preset = (AVATAR_PRESETS as readonly string[]).includes(String(body.avatarPreset)) ? String(body.avatarPreset) : null;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return jsonNoStore({ error: "Usernames are 3 to 20 letters, numbers or underscores." }, 400);
  }
  if (password.length < PASSWORD_MIN || password.length > 128) {
    return jsonNoStore({ error: `Passwords need ${PASSWORD_MIN} to 128 characters.` }, 400);
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    return jsonNoStore({ error: "Pick a password that is different from your username." }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first<{ id: string }>();
  if (existing) return jsonNoStore({ error: "That username is taken. Try another." }, 409);

  const userId = `u_${randomHex(12)}`;
  const salt = randomHex(16);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, display_name, bio, avatar_preset, show_connections, created_at)
     VALUES (?, ?, ?, ?, ?, '', ?, 1, ?)`,
  )
    .bind(userId, username, await hashPassword(password, salt), salt, username, preset, now)
    .run();

  const session = await startSession(req, env, userId, ipHash, embed);
  const user: AuthUser = {
    id: userId,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    avatarPreset: preset,
    bannerUrl: null,
    walletAddress: null,
    walletVerified: false,
    showConnections: true,
    pinnedPostId: null,
    createdAt: now,
    csrfToken: session.csrfToken,
  };
  return jsonNoStore(
    embed ? { user, sessionToken: session.sessionToken } : { user },
    201,
    { "set-cookie": session.cookie },
  );
}

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const body = await readBody(req);
  if (!body) return jsonNoStore({ error: "The request could not be read." }, 400);
  const embed = body.embed === true;
  if (!embed && !originAllowed(req, env)) {
    return jsonNoStore({ error: "This request came from another site and was refused." }, 403);
  }
  const ipHash = await clientIpHash(req);
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 40) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!username || !password) return jsonNoStore({ error: "Enter your username and password." }, 400);

  const perIp = await checkRateLimit(env.DB, `login:${ipHash}`, 15, 600_000);
  const perName = await checkRateLimit(env.DB, `login-user:${username.toLowerCase()}`, 10, 600_000);
  if (!perIp || !perName) {
    return jsonNoStore({ error: "Too many sign-in attempts. Wait a few minutes and try again." }, 429);
  }

  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").bind(username).first<UserRow>();
  const usable = !!row && /^[0-9a-f]{32}$/.test(row.password_salt);
  // Hash even when the account is missing so response time does not reveal which usernames exist.
  const computed = await hashPassword(password, usable ? row.password_salt : "00".repeat(16));
  if (!usable || !constantTimeEqual(computed, row.password_hash)) {
    return jsonNoStore({ error: "That username and password do not match." }, 401);
  }

  const oldSid = readBearerToken(req) || readCookie(req, COOKIE_NAME);
  if (oldSid) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(oldSid)).run();

  const session = await startSession(req, env, row.id, ipHash, embed);
  const user = rowToAuthUser(row, session.csrfToken);
  return jsonNoStore(
    embed ? { user, sessionToken: session.sessionToken } : { user },
    200,
    { "set-cookie": session.cookie },
  );
}

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  const bearer = readBearerToken(req);
  if (!bearer && !originAllowed(req, env)) return jsonNoStore({ error: "This request came from another site and was refused." }, 403);
  if (env.DB) {
    const sid = bearer || readCookie(req, COOKIE_NAME);
    if (sid) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(sid)).run();
  }
  return jsonNoStore({ ok: true }, 200, { "set-cookie": buildCookieHeader(req, "", 0) });
}

export async function handleChangePassword(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  if (!(await checkRateLimit(env.DB, `pw:${auth.user.id}`, 5, 600_000))) {
    return jsonNoStore({ error: "Too many password attempts. Wait a few minutes." }, 429);
  }
  const body = await readBody(req);
  if (!body) return jsonNoStore({ error: "The request could not be read." }, 400);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  if (next.length < PASSWORD_MIN || next.length > 128) {
    return jsonNoStore({ error: `Passwords need ${PASSWORD_MIN} to 128 characters.` }, 400);
  }
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(auth.user.id).first<UserRow>();
  if (!row || !constantTimeEqual(await hashPassword(current, row.password_salt), row.password_hash)) {
    return jsonNoStore({ error: "Your current password is not correct." }, 403);
  }
  const salt = randomHex(16);
  const sid = readCookie(req, COOKIE_NAME) || "";
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(await hashPassword(next, salt), salt, row.id),
    // Every other device is signed out; this session stays.
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(row.id, await sha256Hex(sid)),
  ]);
  return jsonNoStore({ ok: true });
}

export async function handleDeleteAccount(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  if (!(await checkRateLimit(env.DB, `pw:${auth.user.id}`, 5, 600_000))) {
    return jsonNoStore({ error: "Too many password attempts. Wait a few minutes." }, 429);
  }
  const body = await readBody(req);
  const password = body && typeof body.password === "string" ? body.password : "";
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(auth.user.id).first<UserRow>();
  if (!row || !constantTimeEqual(await hashPassword(password, row.password_salt), row.password_hash)) {
    return jsonNoStore({ error: "Your password is not correct." }, 403);
  }
  const id = row.id;
  const media = await env.DB.prepare("SELECT key FROM media_objects WHERE owner_id = ? LIMIT 500").bind(id).all<{ key: string }>();
  if (env.MEDIA) {
    for (const m of media.results) await env.MEDIA.delete(m.key).catch(() => undefined);
  }
  const mine = "(SELECT id FROM posts WHERE author_id = ?)";
  await env.DB.batch([
    // Counters on other people's posts stay truthful after this account's activity is removed.
    env.DB.prepare(
      "UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id IN (SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'post')",
    ).bind(id),
    env.DB.prepare(
      "UPDATE posts SET repost_count = MAX(0, repost_count - 1) WHERE id IN (SELECT repost_of_id FROM posts WHERE author_id = ? AND repost_of_id IS NOT NULL)",
    ).bind(id),
    env.DB.prepare(
      "UPDATE posts SET reply_count = MAX(0, reply_count - (SELECT COUNT(*) FROM post_replies r WHERE r.post_id = posts.id AND r.author_id = ?)) WHERE id IN (SELECT post_id FROM post_replies WHERE author_id = ?)",
    ).bind(id, id),
    env.DB.prepare(`DELETE FROM likes WHERE user_id = ? OR (target_type = 'post' AND target_id IN ${mine})`).bind(id, id),
    env.DB.prepare(`DELETE FROM post_replies WHERE author_id = ? OR post_id IN ${mine}`).bind(id, id),
    env.DB.prepare(`DELETE FROM reposts WHERE user_id = ? OR post_id IN ${mine}`).bind(id, id),
    env.DB.prepare(`DELETE FROM bookmarks WHERE user_id = ? OR post_id IN ${mine}`).bind(id, id),
    env.DB.prepare(`DELETE FROM post_shares WHERE user_id = ? OR post_id IN ${mine}`).bind(id, id),
    env.DB.prepare(`DELETE FROM posts WHERE repost_of_id IN ${mine} AND is_quote = 0`).bind(id),
    env.DB.prepare("DELETE FROM posts WHERE author_id = ?").bind(id),
    env.DB.prepare("DELETE FROM follows WHERE follower_id = ? OR following_id = ?").bind(id, id),
    env.DB.prepare("DELETE FROM notifications WHERE recipient_id = ? OR actor_id = ?").bind(id, id),
    env.DB.prepare("DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?").bind(id, id),
    env.DB.prepare("DELETE FROM token_votes WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM media_objects WHERE owner_id = ?").bind(id),
    env.DB.prepare("DELETE FROM wallet_challenges WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
  return jsonNoStore({ ok: true }, 200, { "set-cookie": buildCookieHeader(req, "", 0) });
}

/** Issues a one-time message for the wallet to sign. It names the site, the account and a random nonce. */
export async function handleWalletChallenge(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  if (!(await checkRateLimit(env.DB, `wallet:${auth.user.id}`, 10, 600_000))) {
    return jsonNoStore({ error: "Too many wallet link attempts. Wait a few minutes." }, 429);
  }
  const host = new URL(req.url).host;
  const message = [
    `${host} wants you to link this wallet to the Threadsium account @${auth.user.username}.`,
    "",
    "Signing proves you control the address. It is free and sends no transaction.",
    "",
    `Chain ID: 99901`,
    `Nonce: ${randomHex(16)}`,
    `Issued: ${new Date().toISOString()}`,
  ].join("\n");
  await env.DB.prepare(
    `INSERT INTO wallet_challenges (user_id, message, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET message = excluded.message, expires_at = excluded.expires_at`,
  )
    .bind(auth.user.id, message, Date.now() + WALLET_CHALLENGE_TTL_MS)
    .run();
  return jsonNoStore({ message, expiresInSeconds: WALLET_CHALLENGE_TTL_MS / 1000 });
}

export async function handleUpdateProfile(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const body = await readBody(req);
  if (!body) return jsonNoStore({ error: "The request could not be read." }, 400);
  const u = auth.user;

  if (body.displayName !== undefined) {
    const dn = String(body.displayName).replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
    if (!dn || dn.length > 40) return jsonNoStore({ error: "Display names are 1 to 40 characters." }, 400);
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(dn, u.id).run();
    u.displayName = dn;
  }
  if (body.bio !== undefined) {
    const bio = String(body.bio).replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
    if (bio.length > 160) return jsonNoStore({ error: "Bios can be up to 160 characters." }, 400);
    await env.DB.prepare("UPDATE users SET bio = ? WHERE id = ?").bind(bio, u.id).run();
    u.bio = bio;
  }
  if (body.avatarPreset !== undefined) {
    const preset = (AVATAR_PRESETS as readonly string[]).includes(String(body.avatarPreset)) ? String(body.avatarPreset) : null;
    await env.DB.prepare("UPDATE users SET avatar_preset = ? WHERE id = ?").bind(preset, u.id).run();
    u.avatarPreset = preset;
  }
  if (body.avatarUrl === null && u.avatarUrl) {
    await env.DB.prepare("UPDATE users SET avatar_url = NULL WHERE id = ?").bind(u.id).run();
    await deleteMediaByUrl(env, u.id, u.avatarUrl);
    u.avatarUrl = null;
  } else if (typeof body.avatarUrl === "string") {
    if (!(await ownsMediaUrl(env, u.id, body.avatarUrl, "avatars"))) {
      return jsonNoStore({ error: "That picture was not uploaded from your account." }, 400);
    }
  }
  if (body.bannerUrl === null && u.bannerUrl) {
    await env.DB.prepare("UPDATE users SET banner_url = NULL WHERE id = ?").bind(u.id).run();
    await deleteMediaByUrl(env, u.id, u.bannerUrl);
    u.bannerUrl = null;
  }
  if (body.showConnections !== undefined) {
    const show = body.showConnections ? 1 : 0;
    await env.DB.prepare("UPDATE users SET show_connections = ? WHERE id = ?").bind(show, u.id).run();
    u.showConnections = !!show;
  }
  if (body.walletAddress !== undefined) {
    if (body.walletAddress === null || body.walletAddress === "") {
      await env.DB.prepare("UPDATE users SET wallet_address = NULL, wallet_verified = 0 WHERE id = ?").bind(u.id).run();
      u.walletAddress = null;
      u.walletVerified = false;
    } else {
      const addr = String(body.walletAddress).trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        return jsonNoStore({ error: "That is not an EVM address. It should be 0x followed by 40 hex characters." }, 400);
      }
      let verified = 0;
      if (typeof body.walletSignature === "string") {
        const challenge = await env.DB.prepare("SELECT message, expires_at FROM wallet_challenges WHERE user_id = ?")
          .bind(u.id)
          .first<{ message: string; expires_at: number }>();
        await env.DB.prepare("DELETE FROM wallet_challenges WHERE user_id = ?").bind(u.id).run();
        if (!challenge || challenge.expires_at < Date.now()) {
          return jsonNoStore({ error: "The signing request expired. Start the wallet link again." }, 400);
        }
        let ok = false;
        try {
          ok = await verifyMessage({ address: addr as Hex, message: challenge.message, signature: body.walletSignature as Hex });
        } catch {
          ok = false;
        }
        if (!ok) return jsonNoStore({ error: "The signature does not match that address." }, 400);
        verified = 1;
      }
      await env.DB.prepare("UPDATE users SET wallet_address = ?, wallet_verified = ? WHERE id = ?").bind(addr.toLowerCase(), verified, u.id).run();
      u.walletAddress = addr.toLowerCase();
      u.walletVerified = verified === 1;
    }
  }
  return jsonNoStore({ user: u });
}
