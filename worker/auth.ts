// Server-side authentication, session management, CSRF protection, and profile updates (R12).
import { verifyMessage, type Hex } from "viem";
import type { Env } from "./env.ts";
import { originAllowed } from "./proxy.ts";
import { checkRateLimit } from "./store.ts";

const COOKIE_NAME = "threadsium_sid";
const SESSION_TTL_MS = 14 * 24 * 3600_000; // 14 days
const PBKDF2_ITERATIONS = 100_000;

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
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
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
    {
      name: "PBKDF2",
      salt: fromHex(saltHex) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function clientIpHash(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "local";
  return sha256Hex(`ip:${ip}`);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function buildCookieHeader(req: Request, value: string, maxAgeSec: number): string {
  const isHttps = new URL(req.url).protocol === "https:";
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) parts.push("Secure");
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

export function jsonNoStore(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store, no-cache, must-revalidate",
      "pragma": "no-cache",
      "vary": "Cookie",
      ...extraHeaders,
    },
  });
}

/** Resolves the authenticated session from the HttpOnly cookie. Returns null if anonymous or expired. */
export async function getSessionUser(req: Request, env: Env): Promise<AuthUser | null> {
  if (!env.DB) return null;
  const sid = readCookie(req, COOKIE_NAME);
  if (!sid || sid.length < 32) return null;
  const tokenHash = await sha256Hex(sid);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT s.csrf_token, s.expires_at, u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<UserRow & { csrf_token: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < now) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return rowToAuthUser(row, row.csrf_token);
}

/** Verifies authentication + Origin + CSRF token for state-changing requests (R12). */
export async function requireMutatingUser(req: Request, env: Env): Promise<{ user: AuthUser } | { error: Response }> {
  if (!originAllowed(req, env)) {
    return { error: jsonNoStore({ error: "Cross-origin state-changing request denied." }, 403) };
  }
  const user = await getSessionUser(req, env);
  if (!user) {
    return { error: jsonNoStore({ error: "Authentication required. Please sign in." }, 401) };
  }
  const csrf = req.headers.get("x-csrf-token");
  if (!csrf || !constantTimeEqual(csrf, user.csrfToken)) {
    return { error: jsonNoStore({ error: "Invalid or missing CSRF token. Refresh the page and try again." }, 403) };
  }
  return { user };
}

export async function handleAuthMe(req: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(req, env);
  return jsonNoStore({ user });
}

export async function handleRegister(req: Request, env: Env): Promise<Response> {
  if (!originAllowed(req, env)) return jsonNoStore({ error: "Forbidden origin." }, 403);
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const ipHash = await clientIpHash(req);
  if (!(await checkRateLimit(env.DB, `reg:${ipHash}`, 10, 600_000))) {
    return jsonNoStore({ error: "Too many registration attempts. Please wait a few minutes." }, 429);
  }

  let body: { username?: unknown; password?: unknown; avatarPreset?: unknown };
  try {
    body = (await req.json()) as { username?: unknown; password?: unknown; avatarPreset?: unknown };
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const avatarPreset = typeof body.avatarPreset === "string" ? body.avatarPreset.trim().slice(0, 40) : "kinepip-samurai";

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return jsonNoStore({ error: "Username must be 3-20 characters (letters, numbers, underscores only)." }, 400);
  }
  if (password.length < 6 || password.length > 128) {
    return jsonNoStore({ error: "Password must be between 6 and 128 characters." }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username)
    .first<{ id: string }>();
  if (existing) {
    return jsonNoStore({ error: "That username is already taken." }, 409);
  }

  const userId = `u_${randomHex(12)}`;
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, display_name, bio, avatar_preset, show_connections, created_at)
     VALUES (?, ?, ?, ?, ?, '', ?, 1, ?)`,
  )
    .bind(userId, username, passwordHash, salt, username, avatarPreset || "kinepip-samurai", now)
    .run();

  const sessionToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const csrfToken = randomHex(24);
  const expiresAt = now + SESSION_TTL_MS;

  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(tokenHash, userId, csrfToken, expiresAt, now, ipHash)
    .run();

  const user: AuthUser = {
    id: userId,
    username,
    displayName: username,
    bio: "",
    avatarUrl: null,
    avatarPreset: avatarPreset || "kinepip-samurai",
    bannerUrl: null,
    walletAddress: null,
    walletVerified: false,
    showConnections: true,
    pinnedPostId: null,
    createdAt: now,
    csrfToken,
  };

  return jsonNoStore({ user }, 201, {
    "set-cookie": buildCookieHeader(req, sessionToken, Math.floor(SESSION_TTL_MS / 1000)),
  });
}

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  if (!originAllowed(req, env)) return jsonNoStore({ error: "Forbidden origin." }, 403);
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const ipHash = await clientIpHash(req);
  if (!(await checkRateLimit(env.DB, `login:${ipHash}`, 15, 600_000))) {
    return jsonNoStore({ error: "Too many sign-in attempts. Please wait a few minutes." }, 429);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { username?: unknown; password?: unknown };
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return jsonNoStore({ error: "Username and password are required." }, 400);
  }

  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username)
    .first<UserRow>();

  if (!row || row.password_hash === "system_locked") {
    return jsonNoStore({ error: "Incorrect username or password." }, 401);
  }

  const computed = await hashPassword(password, row.password_salt);
  if (!constantTimeEqual(computed, row.password_hash)) {
    return jsonNoStore({ error: "Incorrect username or password." }, 401);
  }

  // Rotate session identifier on authentication (R12)
  const oldSid = readCookie(req, COOKIE_NAME);
  if (oldSid) {
    const oldHash = await sha256Hex(oldSid);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(oldHash).run();
  }

  const now = Date.now();
  const sessionToken = randomHex(32);
  const tokenHash = await sha256Hex(sessionToken);
  const csrfToken = randomHex(24);
  const expiresAt = now + SESSION_TTL_MS;

  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(tokenHash, row.id, csrfToken, expiresAt, now, ipHash)
    .run();

  return jsonNoStore({ user: rowToAuthUser(row, csrfToken) }, 200, {
    "set-cookie": buildCookieHeader(req, sessionToken, Math.floor(SESSION_TTL_MS / 1000)),
  });
}

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  if (!originAllowed(req, env)) return jsonNoStore({ error: "Forbidden origin." }, 403);
  if (env.DB) {
    const sid = readCookie(req, COOKIE_NAME);
    if (sid) {
      const tokenHash = await sha256Hex(sid);
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
  }
  return jsonNoStore({ ok: true }, 200, {
    "set-cookie": buildCookieHeader(req, "", 0),
  });
}

export async function handleUpdateProfile(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  let body: {
    displayName?: unknown;
    bio?: unknown;
    avatarPreset?: unknown;
    avatarUrl?: unknown;
    bannerUrl?: unknown;
    walletAddress?: unknown;
    walletSignature?: unknown;
    walletMessage?: unknown;
    showConnections?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const u = auth.user;

  if (body.displayName !== undefined) {
    const dn = String(body.displayName).trim().replace(/\s+/g, " ");
    if (!dn || dn.length > 40) {
      return jsonNoStore({ error: "Display name must be 1-40 characters." }, 400);
    }
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(dn, u.id).run();
    u.displayName = dn;
  }

  if (body.bio !== undefined) {
    const bio = String(body.bio).trim().replace(/\s+/g, " ");
    if (bio.length > 160) {
      return jsonNoStore({ error: "Bio must be 160 characters or fewer." }, 400);
    }
    await env.DB.prepare("UPDATE users SET bio = ? WHERE id = ?").bind(bio, u.id).run();
    u.bio = bio;
  }

  if (body.avatarPreset !== undefined) {
    const preset = body.avatarPreset === null ? null : String(body.avatarPreset).trim().slice(0, 40);
    await env.DB.prepare("UPDATE users SET avatar_preset = ?, avatar_url = NULL WHERE id = ?").bind(preset, u.id).run();
    u.avatarPreset = preset;
    u.avatarUrl = null;
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
        return jsonNoStore({ error: "Invalid EVM address. Must be 0x followed by 40 hex characters." }, 400);
      }
      let verified = 0;
      if (typeof body.walletSignature === "string" && typeof body.walletMessage === "string") {
        try {
          const ok = await verifyMessage({
            address: addr as Hex,
            message: body.walletMessage,
            signature: body.walletSignature as Hex,
          });
          if (ok && body.walletMessage.includes(u.username)) verified = 1;
        } catch {
          verified = 0;
        }
      }
      await env.DB.prepare("UPDATE users SET wallet_address = ?, wallet_verified = ? WHERE id = ?")
        .bind(addr, verified, u.id)
        .run();
      u.walletAddress = addr;
      u.walletVerified = verified === 1;
    }
  }

  return jsonNoStore({ user: u });
}
