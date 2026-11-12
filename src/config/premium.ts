// Threadsium Premium tiers, by THREADSIUM held in a signature-verified wallet:
//   Basic        every account (a verified wallet adds the grey seal)
//   Premium      1,000,000 THREADSIUM: blue check you can restyle, higher limits
//   Premium Max  10,000,000 THREADSIUM: everything in Premium, upgraded, plus a picture badge and more
// Shared by the browser and the Worker, so both enforce the same limits and accept the same badges.

import { PLATFORM_FEE_RECIPIENT } from "./platform.ts";

export type Tier = "basic" | "premium" | "max";
export type PaidTier = Exclude<Tier, "basic">;

export const PREMIUM = {
  symbol: "THREADSIUM",
  /**
   * The THREADSIUM ERC-20 on Elysium 99901. Leave null until the contract is live; the Worker's
   * PREMIUM_TOKEN_ADDRESS variable overrides this without a rebuild.
   */
  tokenAddress: null as string | null,
  /** Whole tokens (not wei) the linked wallet must hold for Premium. */
  minTokens: 1_000_000,
  /** Whole tokens for Premium Max. */
  maxMinTokens: 10_000_000,
  /** The hourly cron re-reads a holder's balance once it is older than this. */
  recheckMs: 6 * 3600_000,
  /** A tier lasts this long after the last balance read that passed, so an RPC outage does not strip it. */
  graceMs: 26 * 3600_000,
  /** Paying instead of holding: one payment of the tier's token amount, valued in HYPE, buys this many days. */
  paidDays: 30,
  /** A HYPE quote holds its price this long. */
  quoteTtlMs: 15 * 60_000,
  /** Window of the on-chain time-weighted average price used for quotes. */
  twapSeconds: 1800,
  /** HYPE payments go to the platform fee wallet (same as swap fees, tips, sends and withdrawals). */
  treasury: PLATFORM_FEE_RECIPIENT,
} as const;

export const TIER_LABEL: Record<Tier, string> = { basic: "Basic", premium: "Premium", max: "Premium Max" };

export interface TierLimits {
  post: number;
  reply: number;
  message: number;
  bio: number;
  displayName: number;
  /** Actions per 10 minutes. */
  postsPer10Min: number;
  repliesPer10Min: number;
  messagesPer10Min: number;
  /** Multiplier on the per-account image storage allowance. */
  storageX: number;
}

export const BASIC_LIMITS: TierLimits = {
  post: 500,
  reply: 400,
  message: 1000,
  bio: 160,
  displayName: 40,
  postsPer10Min: 25,
  repliesPer10Min: 40,
  messagesPer10Min: 40,
  storageX: 1,
};

export const PREMIUM_LIMITS: TierLimits = {
  post: 2000,
  reply: 1000,
  message: 4000,
  bio: 320,
  displayName: 50,
  postsPer10Min: 75,
  repliesPer10Min: 120,
  messagesPer10Min: 120,
  storageX: 2,
};

export const MAX_LIMITS: TierLimits = {
  post: 4000,
  reply: 2000,
  message: 8000,
  bio: 500,
  displayName: 60,
  postsPer10Min: 150,
  repliesPer10Min: 240,
  messagesPer10Min: 240,
  storageX: 4,
};

export const TIER_LIMITS: Record<Tier, TierLimits> = { basic: BASIC_LIMITS, premium: PREMIUM_LIMITS, max: MAX_LIMITS };

/** Limits for a user (or signed-out visitor). Accepts anything carrying a tier. */
export const limitsFor = (u: { tier?: Tier } | null | undefined): TierLimits => TIER_LIMITS[u?.tier ?? "basic"] ?? BASIC_LIMITS;

/** Built-in badge shapes. "check" is the default blue check; "img" is a Premium Max picture. */
export const BADGE_GLYPHS = ["check", "star", "bolt", "diamond", "flame", "crown", "moon", "heart", "leaf", "rocket", "orbit", "thread"] as const;
export type BadgeGlyph = (typeof BADGE_GLYPHS)[number];

export const BADGE_COLORS = {
  blue: "#1d9bf0",
  violet: "#8b5cf6",
  pink: "#ec4899",
  red: "#ef4444",
  orange: "#f97316",
  gold: "#eab308",
  green: "#10b981",
  teal: "#14b8a6",
  silver: "#94a3b8",
} as const;
export type BadgeColor = keyof typeof BADGE_COLORS;

export interface Badge {
  /** A glyph id, "e:" followed by a single emoji, or "img" for the uploaded picture (Premium Max). */
  icon: string;
  color: BadgeColor;
  /** The uploaded badge picture (Premium Max). */
  image?: string | null;
  /** Premium Max: draw the display name in the badge colour. */
  tintName?: boolean;
}

export const DEFAULT_BADGE: Badge = { icon: "check", color: "blue" };

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const BADGE_IMAGE_RE = /^\/api\/media\/badges\/[0-9a-z-]+\.(png|jpg|webp|gif)$/;

export const isBadgeImageUrl = (u: unknown): u is string => typeof u === "string" && BADGE_IMAGE_RE.test(u);

/** One emoji (one grapheme cluster that contains a pictograph or flag), else null. */
export function cleanEmoji(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 32) return null;
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  const count = Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].length : [...s].length <= 8 ? 1 : 2;
  if (count !== 1 || !EMOJI_RE.test(s)) return null;
  return s;
}

/** Validates a badge icon from a request: a known glyph id, "img", or "e:<emoji>". */
export function cleanBadgeIcon(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw === "img") return raw;
  if ((BADGE_GLYPHS as readonly string[]).includes(raw)) return raw;
  if (raw.startsWith("e:")) {
    const e = cleanEmoji(raw.slice(2));
    return e ? `e:${e}` : null;
  }
  return null;
}

export const cleanBadgeColor = (raw: unknown): BadgeColor | null =>
  typeof raw === "string" && Object.prototype.hasOwnProperty.call(BADGE_COLORS, raw) ? (raw as BadgeColor) : null;

/**
 * The badge a holder shows at `tier`, falling back to the blue check for anything unset, invalid or
 * above their tier (a picture badge needs Premium Max; so does the name tint).
 */
export function resolveBadge(
  icon: string | null | undefined,
  color: string | null | undefined,
  image: string | null | undefined = null,
  tint = false,
  tier: Tier = "premium",
): Badge {
  const max = tier === "max";
  let i = cleanBadgeIcon(icon) ?? DEFAULT_BADGE.icon;
  const img = max && isBadgeImageUrl(image) ? image : null;
  if (i === "img" && !img) i = DEFAULT_BADGE.icon;
  const out: Badge = { icon: i, color: cleanBadgeColor(color) ?? DEFAULT_BADGE.color };
  if (img && i === "img") out.image = img;
  if (max && tint) out.tintName = true;
  return out;
}

export const isPremiumUntil = (until: number | null | undefined, now = Date.now()): boolean => typeof until === "number" && until > now;

const units = (whole: number, decimals: number) => BigInt(whole) * 10n ** BigInt(decimals);

/** True when `raw` token units (at `decimals`) reach the Premium threshold. */
export function meetsThreshold(raw: bigint, decimals: number): boolean {
  return raw >= units(PREMIUM.minTokens, decimals);
}

/** The tier a balance qualifies for. */
export function tierForBalance(raw: bigint, decimals: number): Tier {
  if (raw >= units(PREMIUM.maxMinTokens, decimals)) return "max";
  if (raw >= units(PREMIUM.minTokens, decimals)) return "premium";
  return "basic";
}

/** Whole-token amount as a plain string with at most two decimals, for display. */
export function formatUnits2(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = decimals > 0 ? Number(((raw % base) * 100n) / base) : 0;
  return frac ? `${whole}.${String(frac).padStart(2, "0")}` : String(whole);
}

/* ───────── paying in HYPE instead of holding ───────── */

const RANK: Record<Tier, number> = { basic: 0, premium: 1, max: 2 };

export const higherTier = (a: Tier, b: Tier): Tier => (RANK[a] >= RANK[b] ? a : b);
export const tierRank = (t: Tier): number => RANK[t];

/** Whole tokens a tier stands for, which is also what one paid period costs (valued in HYPE). */
export const tokensForTier = (t: PaidTier): number => (t === "max" ? PREMIUM.maxMinTokens : PREMIUM.minTokens);

/**
 * The tier an account has right now: the higher of what its wallet holds and what it paid for, with the
 * `until` that belongs to that tier (the later one when both reach it).
 */
export function effectiveTier(
  s: { heldTier: Tier; heldUntil: number | null; paidTier: Tier; paidUntil: number | null },
  now = Date.now(),
): { tier: Tier; until: number | null } {
  const held: Tier = isPremiumUntil(s.heldUntil, now) ? s.heldTier : "basic";
  const paid: Tier = isPremiumUntil(s.paidUntil, now) ? s.paidTier : "basic";
  const tier = higherTier(held, paid);
  if (tier === "basic") return { tier, until: null };
  const untils = [held === tier ? s.heldUntil : null, paid === tier ? s.paidUntil : null].filter((x): x is number => typeof x === "number");
  return { tier, until: untils.length ? Math.max(...untils) : null };
}

/** HYPE wei for `tokens` at `priceHype` HYPE per token, rounded up to the next 0.000001 HYPE. */
export function quoteWei(tokens: number, priceHype: number): bigint {
  if (!(priceHype > 0) || !Number.isFinite(priceHype)) throw new Error("No usable THREADSIUM price.");
  // toFixed trims float noise (1e7 × 2e-5 × 1e6 = 200000000.00000003) before rounding up.
  const micro = Math.ceil(Number((tokens * priceHype * 1e6).toFixed(6)));
  if (!Number.isSafeInteger(micro) || micro <= 0) throw new Error("The quote is out of range.");
  return BigInt(micro) * 10n ** 12n;
}

/** Wei as a HYPE string with up to 6 decimals. */
export function weiToHypeString(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const micro = (wei % 10n ** 18n) / 10n ** 12n;
  if (!whole && !micro && wei > 0n) return "less than 0.000001";
  return micro ? `${whole}.${String(micro).padStart(6, "0").replace(/0+$/, "")}` : String(whole);
}

/**
 * New paid `until` after a payment for `tier`:
 *   same tier still running → extend from its end
 *   upgrading Premium → Max  → start now, plus the unused Premium time converted at its price (1/10)
 *   otherwise               → start now
 *   buying Premium while Max is running → extend Max by the Premium share of a period (1/10)
 */
export function nextPaidUntil(current: { tier: Tier; until: number | null }, tier: PaidTier, now = Date.now()): number {
  const period = PREMIUM.paidDays * 86_400_000;
  const running = isPremiumUntil(current.until, now) ? current.tier : "basic";
  if (running === tier) return (current.until as number) + period;
  if (running === "max" && tier === "premium") {
    return (current.until as number) + Math.floor(period * (PREMIUM.minTokens / PREMIUM.maxMinTokens));
  }
  if (running === "premium" && tier === "max") {
    const left = (current.until as number) - now;
    return now + period + Math.floor(left * (PREMIUM.minTokens / PREMIUM.maxMinTokens));
  }
  return now + period;
}

/** Uniswap V3 tick → price of `token` in the quote asset (both with their decimals). */
export function tickToPrice(tick: number, tokenIsToken0: boolean, tokenDecimals: number, quoteDecimals: number): number {
  const raw = Math.pow(1.0001, tick); // token1 per token0, in raw units
  const t1PerT0 = tokenIsToken0 ? raw * 10 ** (tokenDecimals - quoteDecimals) : raw * 10 ** (quoteDecimals - tokenDecimals);
  return tokenIsToken0 ? t1PerT0 : 1 / t1PerT0;
}
