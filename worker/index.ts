// Threadsium Cloudflare Worker entry point.
// Serves static assets via Workers Static Assets and routes /api/* with strict security headers and cache policies (R09 & R12).
import {
  handleAuthMe,
  handleLogin,
  handleLogout,
  handleRegister,
  handleUpdateProfile,
  jsonNoStore,
} from "./auth.ts";
import type { Env } from "./env.ts";
import { handleLogo } from "./logo.ts";
import { handleMediaGet, handleMediaUpload } from "./media.ts";
import { handleRpc } from "./proxy.ts";
import { call } from "./rpc.ts";
import {
  handleCreatePost,
  handleCreateTokenComment,
  handleDeletePost,
  handleDeleteTokenComment,
  handleGetConnections,
  handleGetPost,
  handleGetProfile,
  handleLikeTokenComment,
  handleListPosts,
  handleMessages,
  handleModifyReply,
  handleMyAnalytics,
  handleNotifications,
  handlePinPost,
  handlePostReplies,
  handleQuotePost,
  handleRepost,
  handleSearch,
  handleSharePost,
  handleStorageStatus,
  handleToggleFollow,
  handleToggleLikePost,
  handleTokenSocial,
  handleTokenVote,
  handleUpdatePost,
} from "./social.ts";
import { SocialStore, cleanupStore, socialDb } from "./store.ts";
import { handlePrice, handleTokenMeta, handleTokens } from "./tokens.ts";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

function withStores(env: Env): Env {
  if (env.DB) return env;
  if (env.SOCIAL_DO) return { ...env, DB: socialDb(env.SOCIAL_DO) };
  return env;
}

async function routeApi(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  // Blockchain & Market
  if (p === "/api/rpc") return handleRpc(req, env);
  if (p === "/api/price" && m === "GET") return handlePrice(req, env, ctx);
  if (p === "/api/tokens" && m === "GET") return handleTokens(req, env);
  if (p.startsWith("/api/token-meta/") && m === "GET") {
    return handleTokenMeta(req, env, decodeURIComponent(p.slice("/api/token-meta/".length)));
  }
  if (p.startsWith("/api/logo/") && m === "GET") {
    return handleLogo(req, env, ctx, decodeURIComponent(p.slice("/api/logo/".length)));
  }

  // Health & Quota Visibility (R02 & R07)
  if (p === "/api/health" && m === "GET") {
    let chainId: number | null = null;
    let block: number | null = null;
    try {
      chainId = parseInt(await call<string>(env, "eth_chainId", []), 16);
      block = parseInt(await call<string>(env, "eth_blockNumber", []), 16);
    } catch {
      /* reported as null */
    }
    return jsonNoStore({
      ok: chainId === 99901 && !!env.DB,
      chainId,
      block,
      db: !!env.DB,
      r2: !!env.MEDIA,
      kv: !!env.CACHE,
      provisional: true,
    });
  }
  if (p === "/api/status" && m === "GET") return handleStorageStatus(req, env);

  // Auth & Profile Settings
  if (p === "/api/auth/me" && m === "GET") return handleAuthMe(req, env);
  if (p === "/api/auth/register" && m === "POST") return handleRegister(req, env);
  if (p === "/api/auth/login" && m === "POST") return handleLogin(req, env);
  if (p === "/api/auth/logout" && m === "POST") return handleLogout(req, env);
  if (p === "/api/auth/profile" && (m === "PATCH" || m === "POST")) return handleUpdateProfile(req, env);
  if (p === "/api/me/analytics" && m === "GET") return handleMyAnalytics(req, env);

  // Media Uploads & Serving
  if (p === "/api/media/upload" && m === "POST") return handleMediaUpload(req, env);
  if (p.startsWith("/api/media/") && m === "GET") {
    return handleMediaGet(req, env, p.slice("/api/media/".length));
  }

  // Posts, Reposts, Quotes, Likes, Shares, Replies, Pin
  if (p === "/api/posts") {
    if (m === "GET") return handleListPosts(req, env);
    if (m === "POST") return handleCreatePost(req, env);
  }
  if (p === "/api/posts/pin" && m === "DELETE") return handlePinPost(req, env, null);

  const postAction = p.match(/^\/api\/posts\/([^/]+)\/(like|repost|quote|share|pin|replies)$/);
  if (postAction) {
    const postId = decodeURIComponent(postAction[1]);
    const act = postAction[2];
    if (act === "like" && m === "POST") return handleToggleLikePost(req, env, postId);
    if (act === "repost" && (m === "POST" || m === "DELETE")) return handleRepost(req, env, postId);
    if (act === "quote" && m === "POST") return handleQuotePost(req, env, postId);
    if (act === "share" && m === "POST") return handleSharePost(req, env, postId);
    if (act === "pin" && m === "POST") return handlePinPost(req, env, postId);
    if (act === "replies" && (m === "GET" || m === "POST")) return handlePostReplies(req, env, postId);
  }

  const singlePost = p.match(/^\/api\/posts\/([^/]+)$/);
  if (singlePost) {
    const postId = decodeURIComponent(singlePost[1]);
    if (m === "GET") return handleGetPost(req, env, postId);
    if (m === "PATCH") return handleUpdatePost(req, env, postId);
    if (m === "DELETE") return handleDeletePost(req, env, postId);
  }

  const replyRoute = p.match(/^\/api\/replies\/([^/]+)$/);
  if (replyRoute && (m === "PATCH" || m === "DELETE")) {
    return handleModifyReply(req, env, decodeURIComponent(replyRoute[1]));
  }

  // Token Timelines, Comments & Votes
  const tokenRoute = p.match(/^\/api\/tokens\/(0x[a-fA-F0-9]{40})\/(social|comments|vote)$/);
  if (tokenRoute) {
    const addr = tokenRoute[1];
    const sub = tokenRoute[2];
    if (sub === "social" && m === "GET") return handleTokenSocial(req, env, addr);
    if (sub === "comments" && m === "POST") return handleCreateTokenComment(req, env, addr);
    if (sub === "vote" && m === "POST") return handleTokenVote(req, env, addr);
  }

  const commentLike = p.match(/^\/api\/comments\/([^/]+)\/like$/);
  if (commentLike && m === "POST") {
    return handleLikeTokenComment(req, env, decodeURIComponent(commentLike[1]));
  }
  const commentDelete = p.match(/^\/api\/comments\/([^/]+)$/);
  if (commentDelete && m === "DELETE") {
    return handleDeleteTokenComment(req, env, decodeURIComponent(commentDelete[1]));
  }

  // Profiles, Follows & Connections
  const profileAction = p.match(/^\/api\/profiles\/([^/]+)\/(follow|connections)$/);
  if (profileAction) {
    const uname = decodeURIComponent(profileAction[1]);
    const act = profileAction[2];
    if (act === "follow" && m === "POST") return handleToggleFollow(req, env, uname);
    if (act === "connections" && m === "GET") return handleGetConnections(req, env, uname);
  }
  const profileGet = p.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileGet && m === "GET") {
    return handleGetProfile(req, env, decodeURIComponent(profileGet[1]));
  }

  // Search, Notifications, Messages
  if (p === "/api/search" && m === "GET") return handleSearch(req, env);
  if ((p === "/api/notifications" || p === "/api/notifications/read") && (m === "GET" || m === "POST")) {
    return handleNotifications(req, env);
  }
  if ((p === "/api/messages" || p === "/api/messages/read") && (m === "GET" || m === "POST")) {
    return handleMessages(req, env);
  }

  return jsonNoStore({ error: "Not found" }, 404);
}

export { SocialStore };

export default {
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const env = withStores(rawEnv);
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(req);
    }
    try {
      return withSecurityHeaders(await routeApi(req, env, ctx));
    } catch (e) {
      return withSecurityHeaders(
        jsonNoStore({ error: "Something went wrong processing your request. Please try again." }, 500),
      );
    }
  },
  async scheduled(_event: ScheduledController, rawEnv: Env): Promise<void> {
    await cleanupStore(withStores(rawEnv));
  },
} satisfies ExportedHandler<Env>;
