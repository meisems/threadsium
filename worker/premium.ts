// Threadsium Premium tiers: a signature-verified wallet holding THREADSIUM unlocks Premium (1M) or
// Premium Max (10M). Balances are read on chain when the holder asks, when they link a wallet, and by
// the hourly cron, so selling below a threshold changes the tier within PREMIUM.recheckMs (+ grace).
import { parseAbi } from "viem";
import {
  BADGE_COLORS,
  BADGE_GLYPHS,
  PREMIUM,
  TIER_LIMITS,
  TIER_LABEL,
  cleanBadgeColor,
  cleanBadgeIcon,
  formatUnits2,
  isBadgeImageUrl,
  isPremiumUntil,
  resolveBadge,
  tierForBalance,
  type Badge,
  type Tier,
} from "../src/config/premium.ts";
import { getSessionUser, jsonNoStore, requireMutatingUser, type AuthUser } from "./auth.ts";
import type { Env, SqlDb } from "./env.ts";
import { deleteMediaByUrl } from "./media.ts";
import { multicall } from "./rpc.ts";
import { checkRateLimit } from "./store.ts";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);

export function premiumTokenAddress(env: Env): string | null {
  const a = (env.PREMIUM_TOKEN_ADDRESS || PREMIUM.tokenAddress || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(a) ? a.toLowerCase() : null;
}

/** Columns every user row carries for tier and badge. */
export interface PremiumCols {
  premium_until: number | null;
  premium_tier: string | null;
  badge_icon: string | null;
  badge_color: string | null;
  badge_image_url: string | null;
  badge_tint: number | null;
}

/** SQL column list (with an optional table alias and output prefix) matching PremiumCols. */
export function premiumColsSql(alias = "", prefix = ""): string {
  const a = alias ? `${alias}.` : "";
  return ["premium_until", "premium_tier", "badge_icon", "badge_color", "badge_image_url", "badge_tint"]
    .map((c) => (prefix ? `${a}${c} AS ${prefix}${c}` : `${a}${c}`))
    .join(", ");
}

/** Reads PremiumCols out of a row whose columns carry `prefix`. */
export function premiumColsOf(r: Record<string, unknown>, prefix = ""): PremiumCols {
  const g = (k: string) => r[`${prefix}${k}`] as never;
  return {
    premium_until: g("premium_until"),
    premium_tier: g("premium_tier"),
    badge_icon: g("badge_icon"),
    badge_color: g("badge_color"),
    badge_image_url: g("badge_image_url"),
    badge_tint: g("badge_tint"),
  };
}

const asTier = (t: unknown): Tier => (t === "max" ? "max" : t === "premium" ? "premium" : "basic");

/** Tier, premium flag and the badge to draw, from a user row. Basic users never expose a badge. */
export function tierOf(r: PremiumCols, now = Date.now()): { tier: Tier; premium: boolean; badge: Badge | null } {
  const tier: Tier = isPremiumUntil(r.premium_until, now) ? (asTier(r.premium_tier) === "basic" ? "premium" : asTier(r.premium_tier)) : "basic";
  const premium = tier !== "basic";
  return { tier, premium, badge: premium ? resolveBadge(r.badge_icon, r.badge_color, r.badge_image_url, !!r.badge_tint, tier) : null };
}

/** The badge the user picked, whatever their current tier (kept while a tier lapses). */
export function badgeChoiceOf(r: PremiumCols): Badge | null {
  const icon = cleanBadgeIcon(r.badge_icon);
  const color = cleanBadgeColor(r.badge_color);
  const image = isBadgeImageUrl(r.badge_image_url) ? r.badge_image_url : null;
  if (!icon && !color && !image && !r.badge_tint) return null;
  return { icon: icon ?? "check", color: color ?? "blue", image, tintName: !!r.badge_tint };
}

interface Holding {
  balance: bigint;
  decimals: number;
}

/** balanceOf for many wallets in one multicall. Throws when the chain cannot be read. */
async function readHoldings(env: Env, token: string, wallets: string[]): Promise<{ decimals: number; balances: (bigint | null)[] }> {
  const res = await multicall<unknown>(env, [
    { target: token, abi: ERC20, functionName: "decimals" },
    ...wallets.map((w) => ({ target: token, abi: ERC20, functionName: "balanceOf", args: [w] })),
  ]);
  const decimals = res[0] == null ? null : Number(res[0]);
  if (decimals == null || !Number.isFinite(decimals) || decimals > 36) throw new Error("The THREADSIUM contract did not answer decimals().");
  return { decimals, balances: res.slice(1).map((b) => (typeof b === "bigint" ? b : null)) };
}

async function saveCheck(db: SqlDb, userId: string, h: Holding, now: number): Promise<{ until: number | null; tier: Tier }> {
  const tier = tierForBalance(h.balance, h.decimals);
  const until = tier === "basic" ? null : now + PREMIUM.graceMs;
  await db
    .prepare("UPDATE users SET premium_until = ?, premium_tier = ?, premium_checked_at = ?, premium_balance = ?, premium_decimals = ? WHERE id = ?")
    .bind(until, tier === "basic" ? null : tier, now, h.balance.toString(), h.decimals, userId)
    .run();
  return { until, tier };
}

/** Ends any tier and forgets the last balance (wallet removed or replaced). The chosen badge is kept for later. */
export async function clearPremium(db: SqlDb, userId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET premium_until = NULL, premium_tier = NULL, premium_checked_at = NULL, premium_balance = NULL, premium_decimals = NULL WHERE id = ?",
    )
    .bind(userId)
    .run();
}

/** Sets the tier fields on an AuthUser in place. */
export function applyTier(user: AuthUser, tier: Tier, until: number | null): void {
  user.tier = tier;
  user.premium = tier !== "basic";
  user.premiumUntil = user.premium ? until : null;
  const c = user.badgeChoice;
  user.badge = user.premium ? resolveBadge(c?.icon, c?.color, c?.image, !!c?.tintName, tier) : null;
}

export type RefreshOutcome = "ok" | "no-token" | "no-wallet" | "unverified" | "chain-error";

/** Reads the user's balance now and updates their tier. Mutates `user` to match. */
export async function refreshPremium(env: Env, user: AuthUser): Promise<RefreshOutcome> {
  if (!env.DB) return "chain-error";
  const token = premiumTokenAddress(env);
  if (!user.walletAddress) return "no-wallet";
  if (!user.walletVerified) return "unverified";
  if (!token) return "no-token";
  let h: Holding;
  try {
    const { decimals, balances } = await readHoldings(env, token, [user.walletAddress]);
    if (balances[0] == null) return "chain-error";
    h = { balance: balances[0], decimals };
  } catch {
    return "chain-error";
  }
  const { until, tier } = await saveCheck(env.DB, user.id, h, Date.now());
  applyTier(user, tier, until);
  return "ok";
}

interface StatusRow {
  premium_until: number | null;
  premium_checked_at: number | null;
  premium_balance: string | null;
  premium_decimals: number | null;
}

async function statusFor(env: Env, user: AuthUser | null) {
  const token = premiumTokenAddress(env);
  const base = {
    symbol: PREMIUM.symbol,
    tokenAddress: token,
    minTokens: PREMIUM.minTokens,
    maxMinTokens: PREMIUM.maxMinTokens,
    recheckHours: PREMIUM.recheckMs / 3600_000,
    graceHours: PREMIUM.graceMs / 3600_000,
    limits: TIER_LIMITS,
    glyphs: BADGE_GLYPHS,
    colors: BADGE_COLORS,
  };
  if (!user || !env.DB) return { ...base, me: null };
  const row = await env.DB.prepare("SELECT premium_until, premium_checked_at, premium_balance, premium_decimals FROM users WHERE id = ?")
    .bind(user.id)
    .first<StatusRow>();
  const decimals = row?.premium_decimals ?? null;
  const raw = row?.premium_balance ? BigInt(row.premium_balance) : null;
  return {
    ...base,
    me: {
      tier: user.tier,
      premium: user.premium,
      premiumUntil: user.premiumUntil,
      checkedAt: row?.premium_checked_at ?? null,
      balance: raw != null && decimals != null ? formatUnits2(raw, decimals) : null,
      walletAddress: user.walletAddress,
      walletVerified: user.walletVerified,
      badge: user.badgeChoice ?? null,
    },
  };
}

/** GET /api/premium: the program's terms, plus the signed-in user's tier. */
export async function handlePremiumStatus(req: Request, env: Env): Promise<Response> {
  return jsonNoStore(await statusFor(env, await getSessionUser(req, env)));
}

const OUTCOME_ERROR: Record<Exclude<RefreshOutcome, "ok">, [string, number]> = {
  "no-token": ["The THREADSIUM contract is not live yet, so balances cannot be checked.", 503],
  "no-wallet": ["Link a wallet in Settings first.", 400],
  unverified: ["Verify your wallet by signing in Settings first. Pasted addresses cannot unlock Premium.", 400],
  "chain-error": ["The Elysium RPC did not answer. Your tier was not changed. Try again in a minute.", 502],
};

/** POST /api/premium/refresh: re-reads the linked wallet's THREADSIUM balance. */
export async function handlePremiumRefresh(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  if (!(await checkRateLimit(env.DB, `premium:${auth.user.id}`, 8, 600_000))) {
    return jsonNoStore({ error: "Balance checks are limited. Wait a few minutes and try again." }, 429);
  }
  const outcome = await refreshPremium(env, auth.user);
  if (outcome !== "ok") {
    const [error, status] = OUTCOME_ERROR[outcome];
    return jsonNoStore({ error, outcome, ...(await statusFor(env, auth.user)) }, status);
  }
  return jsonNoStore({ user: auth.user, ...(await statusFor(env, auth.user)) });
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * PATCH /api/premium/badge: { icon, color, tintName? } or { reset: true }.
 * Premium and up. "img" (the uploaded picture) and tintName need Premium Max.
 */
export async function handleBadgeUpdate(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const user = auth.user;
  if (!user.premium) return jsonNoStore({ error: `Hold ${fmt(PREMIUM.minTokens)} ${PREMIUM.symbol} in your verified wallet to edit your badge.` }, 403);
  let body: Record<string, unknown> | null = null;
  try {
    const text = await req.text();
    body = text.length <= 1024 ? (JSON.parse(text || "{}") as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return jsonNoStore({ error: "The request could not be read." }, 400);
  const maxOnly = `${TIER_LABEL.max} needs ${fmt(PREMIUM.maxMinTokens)} ${PREMIUM.symbol}.`;

  if (body.reset === true) {
    await env.DB.prepare("UPDATE users SET badge_icon = NULL, badge_color = NULL, badge_tint = 0 WHERE id = ?").bind(user.id).run();
    user.badgeChoice = user.badgeChoice?.image ? { icon: "check", color: "blue", image: user.badgeChoice.image, tintName: false } : null;
    applyTier(user, user.tier, user.premiumUntil);
    return jsonNoStore({ user });
  }

  const icon = cleanBadgeIcon(body.icon);
  const color = cleanBadgeColor(body.color);
  if (!icon || !color) return jsonNoStore({ error: "Pick one of the badge shapes or a single emoji, and one of the colours." }, 400);
  if (icon === "img") {
    if (user.tier !== "max") return jsonNoStore({ error: `A picture badge is a ${TIER_LABEL.max} feature. ${maxOnly}` }, 403);
    if (!user.badgeChoice?.image) return jsonNoStore({ error: "Upload a badge picture first." }, 400);
  }
  const wantTint = body.tintName === true;
  if (wantTint && user.tier !== "max") return jsonNoStore({ error: `Tinting your name is a ${TIER_LABEL.max} feature. ${maxOnly}` }, 403);
  // Keep a saved tint when a Premium (non-Max) holder changes shape, so it returns if they go back to Max.
  const tint = user.tier === "max" ? (wantTint ? 1 : 0) : user.badgeChoice?.tintName ? 1 : 0;
  await env.DB.prepare("UPDATE users SET badge_icon = ?, badge_color = ?, badge_tint = ? WHERE id = ?").bind(icon, color, tint, user.id).run();
  user.badgeChoice = { icon, color, image: user.badgeChoice?.image ?? null, tintName: !!tint };
  applyTier(user, user.tier, user.premiumUntil);
  return jsonNoStore({ user });
}

/** Called by the media upload once a "badge" picture is stored: makes it the badge, drops the previous file. */
export async function setBadgeImage(env: Env, user: AuthUser, url: string): Promise<void> {
  if (!env.DB) return;
  const prev = user.badgeChoice?.image ?? null;
  const color = user.badgeChoice?.color ?? "blue";
  await env.DB.prepare("UPDATE users SET badge_image_url = ?, badge_icon = 'img', badge_color = ? WHERE id = ?").bind(url, color, user.id).run();
  if (prev && prev !== url) await deleteMediaByUrl(env, user.id, prev);
  user.badgeChoice = { icon: "img", color, image: url, tintName: !!user.badgeChoice?.tintName };
  applyTier(user, user.tier, user.premiumUntil);
}

/**
 * Cron: re-reads balances of current holders whose last check is stale, so a holder who sells moves
 * down a tier. Users whose tier already lapsed are not touched; they come back by refreshing.
 */
export async function recheckPremiumHolders(env: Env, max = 400): Promise<void> {
  if (!env.DB) return;
  const token = premiumTokenAddress(env);
  if (!token) return;
  const now = Date.now();
  const due = await env.DB.prepare(
    `SELECT id, wallet_address FROM users
     WHERE premium_until > ? AND wallet_verified = 1 AND wallet_address IS NOT NULL
       AND (premium_checked_at IS NULL OR premium_checked_at < ?)
     ORDER BY premium_checked_at ASC LIMIT ?`,
  )
    .bind(now, now - PREMIUM.recheckMs, max)
    .all<{ id: string; wallet_address: string }>();
  if (!due.results.length) return;
  let read: { decimals: number; balances: (bigint | null)[] };
  try {
    read = await readHoldings(env, token, due.results.map((r) => r.wallet_address));
  } catch {
    return; // Grace period covers an RPC outage.
  }
  for (let i = 0; i < due.results.length; i++) {
    const bal = read.balances[i];
    if (bal == null) continue;
    await saveCheck(env.DB, due.results[i].id, { balance: bal, decimals: read.decimals }, now);
  }
}
