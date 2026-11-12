// Threadsium Premium tiers: a signature-verified wallet holding THREADSIUM unlocks Premium (1M) or
// Premium Max (10M). Balances are read on chain when the holder asks, when they link a wallet, and by
// the hourly cron, so selling below a threshold changes the tier within PREMIUM.recheckMs (+ grace).
// Instead of holding, an account can pay the tier's token amount in HYPE (at a locked on-chain quote) to the
// platform fee wallet for PREMIUM.paidDays; the account gets whichever of held and paid tier is higher.
import { parseAbi } from "viem";
import { CANONICAL_WHYPE, V3_VENUES } from "../src/config/venues.ts";
import {
  BADGE_COLORS,
  BADGE_GLYPHS,
  PREMIUM,
  TIER_LIMITS,
  TIER_LABEL,
  cleanBadgeColor,
  cleanBadgeIcon,
  effectiveTier,
  formatUnits2,
  nextPaidUntil,
  quoteWei,
  tickToPrice,
  tierRank,
  tokensForTier,
  weiToHypeString,
  type PaidTier,
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
import { getUnifiedLaunchpadPairs } from "./launchpads.ts";
import { call, multicall } from "./rpc.ts";
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
  paid_tier: string | null;
  paid_until: number | null;
}

/** SQL column list (with an optional table alias and output prefix) matching PremiumCols. */
export function premiumColsSql(alias = "", prefix = ""): string {
  const a = alias ? `${alias}.` : "";
  return ["premium_until", "premium_tier", "badge_icon", "badge_color", "badge_image_url", "badge_tint", "paid_tier", "paid_until"]
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
    paid_tier: g("paid_tier"),
    paid_until: g("paid_until"),
  };
}

const asTier = (t: unknown): Tier => (t === "max" ? "max" : t === "premium" ? "premium" : "basic");

const heldTierOf = (r: Pick<PremiumCols, "premium_tier">): Tier => (asTier(r.premium_tier) === "basic" ? "premium" : asTier(r.premium_tier));

/** Tier (held or paid, whichever is higher), when it ends, and the badge to draw. Basic users never expose a badge. */
export function tierOf(r: PremiumCols, now = Date.now()): { tier: Tier; until: number | null; premium: boolean; badge: Badge | null } {
  const { tier, until } = effectiveTier(
    { heldTier: heldTierOf(r), heldUntil: r.premium_until, paidTier: asTier(r.paid_tier), paidUntil: r.paid_until },
    now,
  );
  const premium = tier !== "basic";
  return { tier, until, premium, badge: premium ? resolveBadge(r.badge_icon, r.badge_color, r.badge_image_url, !!r.badge_tint, tier) : null };
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

/** Sets the tier fields on an AuthUser in place from a held tier, merging in what the account paid for. */
export function applyTier(user: AuthUser, heldTier: Tier, heldUntil: number | null): void {
  const { tier, until } = effectiveTier({ heldTier, heldUntil, paidTier: user.paidTier, paidUntil: user.paidUntil });
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
  premium_tier: string | null;
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
    pay: {
      available: !!token,
      treasury: PREMIUM.treasury,
      days: PREMIUM.paidDays,
      quoteMinutes: PREMIUM.quoteTtlMs / 60_000,
      priceSource: (env.PREMIUM_PRICE_POOL || "").trim() ? `${PREMIUM.twapSeconds / 60}-minute on-chain average` : "launchpad price feed",
    },
  };
  if (!user || !env.DB) return { ...base, me: null };
  const row = await env.DB.prepare("SELECT premium_until, premium_tier, premium_checked_at, premium_balance, premium_decimals FROM users WHERE id = ?")
    .bind(user.id)
    .first<StatusRow>();
  const decimals = row?.premium_decimals ?? null;
  const raw = row?.premium_balance ? BigInt(row.premium_balance) : null;
  return {
    ...base,
    me: {
      tier: user.tier,
      heldTier: isPremiumUntil(row?.premium_until) ? heldTierOf({ premium_tier: row?.premium_tier ?? null }) : "basic",
      heldUntil: isPremiumUntil(row?.premium_until) ? (row?.premium_until ?? null) : null,
      paidTier: user.paidTier,
      paidUntil: user.paidUntil,
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

/* ───────────────────────── paying in HYPE ───────────────────────── */

const V3_POOL = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);
const WHYPES = new Set([CANONICAL_WHYPE, ...V3_VENUES.map((v) => v.whype)].map((a) => a.toLowerCase()));
const isAddr = (a: unknown): a is string => typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
const treasury = () => PREMIUM.treasury.toLowerCase();

/**
 * THREADSIUM price in HYPE. With PREMIUM_PRICE_POOL set: the pool's time-weighted average over
 * PREMIUM.twapSeconds (a single-block price move cannot cheapen a quote). Otherwise: the launchpad price feed.
 */
export async function threadsiumPriceHype(env: Env, token: string): Promise<{ price: number; source: string }> {
  const pool = (env.PREMIUM_PRICE_POOL || "").trim();
  if (isAddr(pool)) {
    const [t0, t1, obs] = await multicall<unknown>(env, [
      { target: pool, abi: V3_POOL, functionName: "token0" },
      { target: pool, abi: V3_POOL, functionName: "token1" },
      { target: pool, abi: V3_POOL, functionName: "observe", args: [[PREMIUM.twapSeconds, 0]] },
    ]);
    const a0 = String(t0 ?? "").toLowerCase();
    const a1 = String(t1 ?? "").toLowerCase();
    const tokenIs0 = a0 === token;
    const other = tokenIs0 ? a1 : a0;
    if ((!tokenIs0 && a1 !== token) || !WHYPES.has(other)) throw new Error("PREMIUM_PRICE_POOL is not a THREADSIUM/WHYPE pool.");
    const cums = Array.isArray(obs) ? (obs[0] as readonly bigint[]) : null;
    if (!cums || cums.length !== 2) throw new Error("The price pool has no price history yet.");
    const [dT, dO] = await multicall<unknown>(env, [
      { target: token, abi: ERC20, functionName: "decimals" },
      { target: other, abi: ERC20, functionName: "decimals" },
    ]);
    const avgTick = Math.floor(Number(cums[1] - cums[0]) / PREMIUM.twapSeconds);
    const price = tickToPrice(avgTick, tokenIs0, Number(dT ?? 18), Number(dO ?? 18));
    return { price, source: `${PREMIUM.twapSeconds / 60}-minute average, pool ${pool.slice(0, 6)}…${pool.slice(-4)}` };
  }
  const pairs = await getUnifiedLaunchpadPairs(env).catch(() => []);
  const hit = pairs.find((p) => p.token.toLowerCase() === token && p.priceHype > 0);
  if (!hit) throw new Error("No THREADSIUM price is available right now.");
  return { price: hit.priceHype, source: "launchpad price feed" };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > 2048) return null;
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const rid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** POST /api/premium/quote { tier }: locks the HYPE price of one paid period for PREMIUM.quoteTtlMs. */
export async function handlePremiumQuote(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `pquote:${user.id}`, 20, 600_000))) {
    return jsonNoStore({ error: "Too many quotes. Wait a few minutes and try again." }, 429);
  }
  const body = await readJsonBody(req);
  const tier: PaidTier | null = body?.tier === "max" ? "max" : body?.tier === "premium" ? "premium" : null;
  if (!tier) return jsonNoStore({ error: "Pick Premium or Premium Max." }, 400);
  if (!user.walletAddress || !user.walletVerified) {
    return jsonNoStore({ error: "Verify your wallet in Settings first. Payments are matched to the wallet you signed with." }, 400);
  }
  const token = premiumTokenAddress(env);
  if (!token) return jsonNoStore({ error: "The THREADSIUM contract is not live yet, so there is no price to pay." }, 503);

  let price: { price: number; source: string };
  let amount: bigint;
  try {
    price = await threadsiumPriceHype(env, token);
    amount = quoteWei(tokensForTier(tier), price.price);
  } catch (e) {
    return jsonNoStore({ error: (e as Error).message || "No THREADSIUM price is available right now." }, 503);
  }
  const now = Date.now();
  const id = rid("q");
  const expiresAt = now + PREMIUM.quoteTtlMs;
  await env.DB.prepare(
    "INSERT INTO premium_quotes (id, user_id, tier, wallet, price_hype, amount_wei, source, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, user.id, tier, user.walletAddress, String(price.price), amount.toString(), price.source, now, expiresAt)
    .run();
  return jsonNoStore({
    quote: {
      id,
      tier,
      tokens: tokensForTier(tier),
      priceHype: price.price,
      source: price.source,
      amountWei: amount.toString(),
      amountHype: weiToHypeString(amount),
      treasury: PREMIUM.treasury,
      wallet: user.walletAddress,
      days: PREMIUM.paidDays,
      createdAt: now,
      expiresAt,
      paidUntilAfter: nextPaidUntil({ tier: user.paidTier, until: user.paidUntil }, tier, now),
    },
  });
}

interface RpcTx {
  from: string;
  to: string | null;
  value: string;
  chainId?: string;
}

interface QuoteRow {
  id: string;
  tier: string;
  wallet: string;
  amount_wei: string;
  created_at: number;
  expires_at: number;
}

/** Slack between our clock and block timestamps when checking that a payment falls inside its quote window. */
const CLOCK_SLACK_MS = 120_000;

const rpcDown = () =>
  jsonNoStore({ error: "The Elysium RPC did not answer. Your payment is safe; check again in a minute.", pending: true }, 502);

/**
 * POST /api/premium/pay { txHash, quoteId? }: verifies a HYPE transfer on chain and grants the paid tier.
 * The transaction must be confirmed, come from the account's verified wallet, go to the platform fee wallet,
 * carry at least the quoted amount, and land between the quote's creation and expiry. Each transaction and
 * each quote can be used once. Without quoteId, the largest open quote the transaction satisfies is used.
 */
export async function handlePremiumPay(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `ppay:${user.id}`, 40, 600_000))) {
    return jsonNoStore({ error: "Too many checks. Wait a few minutes and try again." }, 429);
  }
  const body = await readJsonBody(req);
  const txHash = typeof body?.txHash === "string" ? body.txHash.trim().toLowerCase() : "";
  const quoteId = typeof body?.quoteId === "string" && /^q_[0-9a-f]{20}$/.test(body.quoteId) ? body.quoteId : null;
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return jsonNoStore({ error: "That is not a transaction hash (0x followed by 64 hex characters)." }, 400);

  const prior = await env.DB.prepare("SELECT user_id, tier, until FROM premium_payments WHERE tx_hash = ?")
    .bind(txHash)
    .first<{ user_id: string; tier: string; until: number }>();
  if (prior) {
    if (prior.user_id !== user.id) return jsonNoStore({ error: "That transaction was already used by another account." }, 409);
    return jsonNoStore({ user, payment: { tier: prior.tier, until: prior.until, already: true } });
  }
  const wallet = user.walletAddress;
  if (!wallet || !user.walletVerified) {
    return jsonNoStore({ error: "Verify your wallet in Settings first. Payments are matched to the wallet you signed with." }, 400);
  }

  let tx: RpcTx | null;
  let receipt: { status: string; blockNumber: string } | null;
  try {
    [tx, receipt] = await Promise.all([
      call<RpcTx | null>(env, "eth_getTransactionByHash", [txHash]),
      call<{ status: string; blockNumber: string } | null>(env, "eth_getTransactionReceipt", [txHash]),
    ]);
  } catch {
    return rpcDown();
  }
  if (!tx || !receipt) return jsonNoStore({ pending: true, message: "Waiting for the transaction to confirm." }, 202);
  if (receipt.status !== "0x1") return jsonNoStore({ error: "That transaction failed on chain, so no HYPE was sent." }, 400);
  if (tx.chainId && BigInt(tx.chainId) !== 99901n) return jsonNoStore({ error: "That transaction is not on Elysium (chain 99901)." }, 400);
  if ((tx.to ?? "").toLowerCase() !== treasury()) {
    return jsonNoStore({ error: `That transaction did not pay the Threadsium wallet ${PREMIUM.treasury}.` }, 400);
  }
  const from = tx.from.toLowerCase();
  if (from !== wallet.toLowerCase()) {
    return jsonNoStore({ error: "That payment came from a different wallet than the one verified on this account." }, 400);
  }
  const value = BigInt(tx.value);
  let blockMs: number;
  try {
    const block = await call<{ timestamp: string } | null>(env, "eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (!block) throw new Error("no block");
    blockMs = Number(BigInt(block.timestamp)) * 1000;
  } catch {
    return rpcDown();
  }

  const quotes = quoteId
    ? await env.DB.prepare(
        "SELECT id, tier, wallet, amount_wei, created_at, expires_at FROM premium_quotes WHERE id = ? AND user_id = ? AND used_tx IS NULL",
      )
        .bind(quoteId, user.id)
        .all<QuoteRow>()
    : await env.DB.prepare(
        "SELECT id, tier, wallet, amount_wei, created_at, expires_at FROM premium_quotes WHERE user_id = ? AND used_tx IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 40",
      )
        .bind(user.id, Date.now() - 7 * 86_400_000)
        .all<QuoteRow>();
  const usable = quotes.results.filter(
    (q) => blockMs >= q.created_at - CLOCK_SLACK_MS && blockMs <= q.expires_at + CLOCK_SLACK_MS && q.wallet.toLowerCase() === from,
  );
  // Prefer the most valuable quote the payment covers (a Max quote over a Premium one).
  const match = usable.filter((q) => value >= BigInt(q.amount_wei)).sort((a, b) => (BigInt(b.amount_wei) > BigInt(a.amount_wei) ? 1 : -1))[0];
  if (!match) {
    if (usable.length) {
      const need = usable.map((q) => BigInt(q.amount_wei)).reduce((m, x) => (x < m ? x : m));
      return jsonNoStore(
        {
          error: `That payment sent ${weiToHypeString(value)} HYPE but the quote was ${weiToHypeString(need)} HYPE. Contact support with the transaction hash.`,
        },
        400,
      );
    }
    return jsonNoStore(
      { error: "No open quote matches that payment's time and wallet. Contact support with the transaction hash." },
      400,
    );
  }

  const tier: PaidTier = match.tier === "max" ? "max" : "premium";
  const now = Date.now();
  const fresh = await env.DB.prepare("SELECT paid_tier, paid_until FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ paid_tier: string | null; paid_until: number | null }>();
  const current = { tier: asTier(fresh?.paid_tier), until: fresh?.paid_until ?? null };
  const until = nextPaidUntil(current, tier, now);
  // Claim first: the primary key on tx_hash and the unique quote_id make a second claim fail here.
  try {
    await env.DB.prepare(
      "INSERT INTO premium_payments (tx_hash, user_id, quote_id, tier, wallet, value_wei, block_number, paid_at, until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(txHash, user.id, match.id, tier, from, value.toString(), Number(BigInt(receipt.blockNumber)), blockMs, until, now)
      .run();
  } catch {
    return jsonNoStore({ error: "That transaction or quote was already used." }, 409);
  }
  // Buying Premium while Max is paid up extends Max (see nextPaidUntil), so the higher tier is kept.
  const newTier: Tier = isPremiumUntil(current.until, now) && tierRank(current.tier) > tierRank(tier) ? current.tier : tier;
  await env.DB.batch([
    env.DB.prepare("UPDATE premium_quotes SET used_tx = ? WHERE id = ?").bind(txHash, match.id),
    env.DB.prepare("UPDATE users SET paid_tier = ?, paid_until = ? WHERE id = ?").bind(newTier, until, user.id),
  ]);
  user.paidTier = newTier;
  user.paidUntil = until;
  applyTier(user, user.tier, user.premiumUntil);
  return jsonNoStore({ user, payment: { tier: newTier, until, valueHype: weiToHypeString(value), txHash } });
}
