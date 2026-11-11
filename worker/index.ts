// Threadsium Worker entry. Static assets come from Workers Static Assets; /api/* is handled here.
import {
  handleAuthMe,
  handleChangePassword,
  handleDeleteAccount,
  handleLogin,
  handleLogout,
  handleRegister,
  handleUpdateProfile,
  handleWalletChallenge,
  jsonNoStore,
} from "./auth.ts";
import { handleWhales } from "./elywake/feed.ts";
import type { Env } from "./env.ts";
import { handleCandles, handleLaunchpads } from "./launchpads.ts";
import { handleLaunchpadLogo, handleLogo } from "./logo.ts";
import { handleMediaGet, handleMediaUpload, mediaLimits } from "./media.ts";
import { handleRpc } from "./proxy.ts";
import { call } from "./rpc.ts";
import {
  handleConversation,
  handleConversationRead,
  handleCounts,
  handleCreatePost,
  handleCreateReply,
  handleDeletePost,
  handleDiscover,
  handleGetConnections,
  handleGetPost,
  handleGetProfile,
  handleListPosts,
  handleListSaved,
  handleMessageTransfer,
  handleModifyReply,
  handleMyInsights,
  handleNotifications,
  handlePinPost,
  handleProfileReplies,
  handleReact,
  handleRepost,
  handleRoom,
  handleRoomMessagePost,
  handleRoomSync,
  handleRoomVote,
  handleSave,
  handleSearch,
  handleSharePost,
  handleStatus,
  handleThreads,
  handleToggleFollow,
  handleUpdatePost,
} from "./social.ts";
import { SocialStore, cleanupStore, connectRoomWebSocket, socialDb } from "./store.ts";
import { handlePrice, handleTokenMeta, handleTokens } from "./tokens.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

function isCrossPlatformPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/rooms/") ||
    pathname.startsWith("/api/chat/") ||
    pathname.startsWith("/api/posts") ||
    pathname.startsWith("/api/tokens") ||
    pathname.startsWith("/api/launchpads") ||
    pathname.startsWith("/api/candles/") ||
    pathname.startsWith("/api/token-meta/") ||
    pathname.startsWith("/api/logo/") ||
    pathname.startsWith("/api/launchpad-logo/") ||
    pathname === "/api/price" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth/")
  );
}

function applyCorsHeaders(req: Request, headers: Headers, pathname: string): void {
  if (!isCrossPlatformPath(pathname)) return;
  const origin = req.headers.get("origin");
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin, Cookie, Authorization");
  } else {
    headers.set("access-control-allow-origin", "*");
  }
  headers.set("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, X-CSRF-Token, Authorization");
  headers.set("cross-origin-resource-policy", "cross-origin");
}

function withSecurityHeaders(req: Request, res: Response): Response {
  if (res.status === 101) return res;
  const url = new URL(req.url);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  applyCorsHeaders(req, out.headers, url.pathname);
  return out;
}

function withEmbedHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.delete("x-frame-options");
  out.headers.set(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss: https://rpc.elysium.kinetiq.xyz https://rpc-live.boxa.club https://rpc.elyscan.live https://rpc.agoradex.app; frame-ancestors *; base-uri 'self'; form-action 'self'; object-src 'none'",
  );
  out.headers.set("cross-origin-resource-policy", "cross-origin");
  out.headers.set("cross-origin-opener-policy", "unsafe-none");
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return out;
}

function withStores(env: Env): Env {
  if (env.DB) return env;
  if (env.SOCIAL_DO) return { ...env, DB: socialDb(env.SOCIAL_DO) };
  return env;
}

function seg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

async function routeApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;
  let match: RegExpMatchArray | null;

  // Chain and market data (public)
  if (p === "/api/rpc") return handleRpc(req, env);
  if (p === "/api/price" && m === "GET") return handlePrice(req, env, ctx);
  if (p === "/api/whales" && m === "GET") return handleWhales(req, env, ctx);
  if (p === "/api/tokens" && m === "GET") return handleTokens(req, env);
  if (p === "/api/launchpads" && m === "GET") return handleLaunchpads(req, env);
  if (p.startsWith("/api/candles/") && m === "GET") return handleCandles(req, env, seg(p.slice("/api/candles/".length)));
  if (p.startsWith("/api/token-meta/") && m === "GET") return handleTokenMeta(req, env, seg(p.slice("/api/token-meta/".length)));
  if (p.startsWith("/api/logo/") && m === "GET") return handleLogo(req, env, ctx, seg(p.slice("/api/logo/".length)));
  if (p.startsWith("/api/launchpad-logo/") && m === "GET") return handleLaunchpadLogo(req, env, ctx, seg(p.slice("/api/launchpad-logo/".length)));

  if (p === "/api/health" && m === "GET") {
    let chainId: number | null = null;
    let block: number | null = null;
    try {
      chainId = parseInt(await call<string>(env, "eth_chainId", []), 16);
      block = parseInt(await call<string>(env, "eth_blockNumber", []), 16);
    } catch {
      /* reported as null */
    }
    return jsonNoStore({ ok: chainId === 99901 && !!env.DB, chainId, block, db: !!env.DB, r2: !!env.MEDIA, kv: !!env.CACHE });
  }
  if (p === "/api/status" && m === "GET") return handleStatus(req, env);
  if (p === "/api/limits" && m === "GET") {
    const l = mediaLimits(env);
    return new Response(JSON.stringify({ media: l }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
    });
  }

  // Account
  if (p === "/api/auth/me" && m === "GET") return handleAuthMe(req, env);
  if (p === "/api/auth/register" && m === "POST") return handleRegister(req, env);
  if (p === "/api/auth/login" && m === "POST") return handleLogin(req, env);
  if (p === "/api/auth/logout" && m === "POST") return handleLogout(req, env);
  if (p === "/api/auth/profile" && m === "PATCH") return handleUpdateProfile(req, env);
  if (p === "/api/auth/password" && m === "POST") return handleChangePassword(req, env);
  if (p === "/api/auth/wallet-challenge" && m === "POST") return handleWalletChallenge(req, env);
  if (p === "/api/auth/account" && m === "DELETE") return handleDeleteAccount(req, env);
  if (p === "/api/me/insights" && m === "GET") return handleMyInsights(req, env);
  if (p === "/api/me/counts" && m === "GET") return handleCounts(req, env);
  if (p === "/api/me/saved" && m === "GET") return handleListSaved(req, env);

  // Media
  if (p === "/api/media/upload" && m === "POST") return handleMediaUpload(req, env);
  if (p.startsWith("/api/media/") && m === "GET") return handleMediaGet(req, env, p.slice("/api/media/".length));

  // Posts
  if (p === "/api/posts") {
    if (m === "GET") return handleListPosts(req, env);
    if (m === "POST") return handleCreatePost(req, env);
  }
  if ((match = p.match(/^\/api\/posts\/([^/]+)\/(react|repost|save|share|pin|replies)$/)) && m === "POST") {
    const id = seg(match[1]);
    switch (match[2]) {
      case "react":
        return handleReact(req, env, id);
      case "repost":
        return handleRepost(req, env, id);
      case "save":
        return handleSave(req, env, id);
      case "share":
        return handleSharePost(req, env, id);
      case "pin":
        return handlePinPost(req, env, id);
      case "replies":
        return handleCreateReply(req, env, id);
    }
  }
  if ((match = p.match(/^\/api\/posts\/([^/]+)$/))) {
    const id = seg(match[1]);
    if (m === "GET") return handleGetPost(req, env, id);
    if (m === "PATCH") return handleUpdatePost(req, env, id);
    if (m === "DELETE") return handleDeletePost(req, env, id);
  }
  if ((match = p.match(/^\/api\/replies\/([^/]+)$/)) && (m === "PATCH" || m === "DELETE")) {
    return handleModifyReply(req, env, seg(match[1]));
  }

  // Token rooms (accepts 0x<40-hex> or 99901-0x<40-hex> across /api/rooms/* and /api/chat/*)
  if ((match = p.match(/^\/api\/(?:rooms|chat)\/((?:99901[-:])?0x[a-fA-F0-9]{40})(?:\/(vote|sync|messages|ws))?$/))) {
    const roomId = match[1];
    const sub = match[2];
    if (!sub && m === "GET") return p.startsWith("/api/chat/") ? handleRoomSync(req, env, roomId) : handleRoom(req, env, roomId);
    if (sub === "vote" && m === "POST") return handleRoomVote(req, env, roomId);
    if ((sub === "sync" || sub === "messages") && m === "GET") return handleRoomSync(req, env, roomId);
    if (sub === "messages" && m === "POST") return handleRoomMessagePost(req, env, roomId);
    if (sub === "ws" && m === "GET") {
      const addr = roomId.replace(/^99901[-:]/, "").toLowerCase();
      return connectRoomWebSocket(req, env, addr);
    }
  }

  // Profiles
  if ((match = p.match(/^\/api\/profiles\/([^/]+)\/(follow|connections|replies)$/))) {
    const name = seg(match[1]);
    if (match[2] === "follow" && m === "POST") return handleToggleFollow(req, env, name);
    if (match[2] === "connections" && m === "GET") return handleGetConnections(req, env, name);
    if (match[2] === "replies" && m === "GET") return handleProfileReplies(req, env, name);
  }
  if ((match = p.match(/^\/api\/profiles\/([^/]+)$/)) && m === "GET") return handleGetProfile(req, env, seg(match[1]));

  // Search, discovery, notifications, messages
  if (p === "/api/search" && m === "GET") return handleSearch(req, env);
  if (p === "/api/discover" && m === "GET") return handleDiscover(req, env);
  if (p === "/api/notifications" && m === "GET") return handleNotifications(req, env);
  if (p === "/api/notifications/read" && m === "POST") return handleNotifications(req, env);
  if (p === "/api/messages" && m === "GET") return handleThreads(req, env);
  if ((match = p.match(/^\/api\/messages\/([^/]+)\/read$/)) && m === "POST") return handleConversationRead(req, env, seg(match[1]));
  if ((match = p.match(/^\/api\/messages\/([^/]+)\/transfer$/)) && m === "POST") return handleMessageTransfer(req, env, seg(match[1]));
  if ((match = p.match(/^\/api\/messages\/([^/]+)$/)) && (m === "GET" || m === "POST")) {
    return handleConversation(req, env, seg(match[1]));
  }

  return jsonNoStore({ error: "Not found" }, 404);
}

export { SocialStore };

export default {
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = withStores(rawEnv);
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) {
      const assetRes = await env.ASSETS.fetch(req);
      if (url.pathname.startsWith("/embed/")) return withEmbedHeaders(assetRes);
      return assetRes;
    }
    if (req.method === "OPTIONS" && isCrossPlatformPath(url.pathname)) {
      const headers = new Headers();
      applyCorsHeaders(req, headers, url.pathname);
      headers.set("access-control-max-age", "86400");
      return new Response(null, { status: 204, headers });
    }
    try {
      return withSecurityHeaders(req, await routeApi(req, env, ctx));
    } catch (e) {
      console.error("api error", url.pathname, (e as Error)?.message);
      return withSecurityHeaders(req, jsonNoStore({ error: "Something went wrong on our side. Try again." }, 500));
    }
  },
  async scheduled(_event: ScheduledController, rawEnv: Env): Promise<void> {
    await cleanupStore(withStores(rawEnv));
  },
} satisfies ExportedHandler<Env>;
