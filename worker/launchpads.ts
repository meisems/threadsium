// Elysium 99901 Launchpad Rankings, Live Launchpad Feed, and 5-Tier Candle Cascade.
// GET /api/launchpads
// GET /api/candles/:address?res=5m|1h|1d
//
// Aggregates live data from:
//   - ELYXA pairs index (elyxa.trade/api/pairs)
//   - Montra Markets API (api.montramarkets.xyz/api/tokens)
//   - Kleos launchpad board (www.thekleos.pro/api/board)
//   - BOXA all-token index (boxa.club/api/index/tokens?launchpad=...)
//   - Threadsium's own on-chain launch index (worker/launchIndex.ts), which decides each token's launchpad
//   - Threadsium D1 room post & sentiment counts
// Also feeds every discovered token image URL directly into `rememberLogoUrl` for 0ms Fast-Track Logo resolution.

import { getAddress } from "viem";
import {
  LAUNCHPAD_REGISTRY,
  launchpadById,
  launchpadOfPool,
  launchpadTokenOf,
  type LaunchpadContract,
  type LaunchpadTokenInfo,
} from "../src/config/launchpads.ts";
import type { Env } from "./env.ts";
import {
  NOT_LAUNCHED,
  launchpadsOfTokens,
  readLaunchIndex,
  syncLaunchIndex,
  type LaunchIndexSummary,
} from "./launchIndex.ts";
import { rememberLogoUrl, safeImageUrl } from "./logo.ts";

const UA = "Threadsium/1.0 (+launchpad index)";
const DAY_SECONDS = 86_400;

// Quote and bridged assets that trade in launchpad venues' pools but were not launched there
const NOT_LAUNCHES = NOT_LAUNCHED;

export interface NormalizedPair {
  pool: string;
  version: "v3" | "v4";
  group: string;
  venue: string;
  launchpadId: string | null;
  launchpadName: string;
  factory?: string | null;
  hooks?: string | null;
  token: string;
  symbol: string;
  name: string;
  image: string | null;
  createdAt: number | null;
  holders: number | null;
  top10Pct: number | null;
  burnedPct: number | null;
  priceHype: number;
  mcapHype: number;
  liquidityHype: number;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  trades1h: number;
  change24h: number | null;
}

export interface LaunchpadCoinSummary {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  launchpadId: string;
  launchpadName: string;
  venue: string;
  createdAt: number | null;
  holders: number | null;
  priceHype: number;
  mcapHype: number;
  liquidityHype: number;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  trades1h: number;
  change24h: number | null;
  commentCount: number;
  isLaunchpadToken: boolean;
}

export interface LaunchpadRankingEntry {
  id: string;
  name: string;
  shortName: string;
  site: string | null;
  status: "live" | "pre-mainnet" | "in development";
  summary: string;
  contracts: LaunchpadContract[];
  /** True when at least one launch contract of this launchpad was verified on-chain and is indexed. */
  verifiedOnChain: boolean;
  /** Launches found by the on-chain index (null when the index is unavailable). */
  indexedLaunches: number | null;
  token:
    | (LaunchpadTokenInfo & {
        priceHype: number;
        mcapHype: number;
        liquidityHype: number;
        volume24h: number;
        holders: number | null;
        commentCount: number;
      })
    | null;
  launches: number;
  launches24h: number;
  launches10Holders: number;
  volume24h: number;
  volume1h: number;
  trades24h: number;
  trades1h: number;
  mcapHype: number;
  liquidityHype: number;
  discussionCount: number;
  topCoins: LaunchpadCoinSummary[];
  newCoins: LaunchpadCoinSummary[];
}

const cleanStr = (v: unknown, max = 48): string =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, max);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Convert a wei integer string (18 decimals) from Montra to HYPE float. */
export function weiToHype(raw: unknown, decimals = 18): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e14 ? raw / 10 ** decimals : raw;
  }
  if (typeof raw !== "string") return 0;
  const s = raw.trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) {
    try {
      const big = BigInt(s);
      const scale = 10n ** BigInt(Math.max(0, decimals - 6));
      return Number(big / scale) / 10 ** Math.min(6, decimals);
    } catch {
      return 0;
    }
  }
  const parsed = Number(s);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Map ELYXA group / launchpad names to our canonical group or launchpad IDs
function mapElyxaGroup(rawGroup: string, rawVenue: string): string {
  const g = (rawGroup || rawVenue || "").toLowerCase();
  if (g.includes("montra")) return "montra";
  if (g.includes("kleos") && g.includes("v4")) return "kleos-v4";
  if (g.includes("kleos")) return "kleos";
  if (g.includes("boxa") && g.includes("v4")) return "boxa-v4";
  if (g.includes("boxa") && g.includes("gen")) return "boxa-genesis";
  if (g.includes("boxa")) return "boxa";
  if (g.includes("elyxa") || g.includes("synapse")) return "elyxa-v4";
  if (g.includes("obol")) return "obol";
  if (g.includes("eleos")) return "eleos-v4";
  if (g.includes("volta")) return "volta";
  if (g.includes("ronspad") || g.includes("rons")) return "ronspad";
  if (g.includes("elyspump") && g.includes("v4")) return "elyspump-v4";
  if (g.includes("elyspump")) return "elyspump-v3";
  if (g.includes("chainzy") && g.includes("v2")) return "chainzy-v2";
  if (g.includes("chainzy")) return "chainzy";
  if (g.includes("stockium")) return "stockium";
  if (g.includes("olympad")) return "olympad";
  if (g.includes("hookium")) return "hookium";
  if (g.includes("perpme")) return "perpme";
  if (g.includes("supercolony")) return "supercolony";
  if (g.includes("mesa")) return "mesa";
  if (g.includes("hesperia")) return "hesperia";
  if (g.includes("ascend")) return "ascend";
  return g;
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function parseElyxaPair(r: Record<string, unknown>): NormalizedPair | null {
  const tokRaw = String(r.token ?? r.baseToken ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(tokRaw)) return null;
  const pool = String(r.pool ?? r.pairAddress ?? tokRaw).toLowerCase();

  const img = safeImageUrl(r.image);
  if (img) rememberLogoUrl(tokRaw, img);

  const rawGroup = String(r.group ?? r.launchpad ?? "");
  const rawVenue = String(r.venue ?? r.launchpad ?? r.group ?? "Elysium Pool");
  const group = mapElyxaGroup(rawGroup, rawVenue);
  const hooks =
    typeof (r.hooks ?? r.hook) === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(String(r.hooks ?? r.hook))
      ? String(r.hooks ?? r.hook).toLowerCase()
      : null;
  const factory =
    typeof r.factory === "string" && /^0x[0-9a-fA-F]{40}$/.test(r.factory)
      ? r.factory.toLowerCase()
      : null;
  const lp = launchpadOfPool(group, hooks, factory);

  let createdAt = optNum(r.created_at ?? r.createdAt ?? r.launchedAt);
  if (createdAt && createdAt > 1e12) createdAt = Math.floor(createdAt / 1000);

  const priceHype = Math.max(0, num(r.price ?? r.priceHype ?? r.priceNative));
  let mcapHype = Math.max(
    0,
    num(r.mcap ?? r.mcapHype ?? r.mcapNative ?? r.marketCap ?? r.fdv)
  );
  if (
    mcapHype === 0 &&
    priceHype > 0 &&
    typeof r.total_supply === "string" &&
    /^\d+$/.test(r.total_supply)
  ) {
    const supply = weiToHype(r.total_supply, num(r.decimals) || 18);
    if (supply > 0) mcapHype = supply * priceHype;
  }
  if (mcapHype > 1e8) mcapHype = 0;

  const buys1h = Math.max(0, Math.round(num(r.buys1h)));
  const sells1h = Math.max(0, Math.round(num(r.sells1h)));
  const tx1h = Math.max(
    0,
    buys1h + sells1h || Math.round(num(r.txns1h ?? r.trades1h))
  );
  const tx24h = Math.max(
    0,
    Math.round(num(r.txWindow ?? r.trades ?? r.txns24h ?? r.trades24h))
  );

  return {
    pool,
    version:
      String(r.version ?? "").toLowerCase() === "v4" ||
      hooks ||
      pool.includes(":")
        ? "v4"
        : "v3",
    group,
    venue: cleanStr(rawVenue || lp?.name || "Elysium Pool", 32),
    launchpadId: lp?.id ?? null,
    launchpadName: lp?.name ?? cleanStr(rawGroup || rawVenue || "Elysium", 28),
    factory,
    hooks,
    token: tokRaw,
    symbol:
      cleanStr(r.symbol, 20).replace(/^\$+/, "") || tokRaw.slice(0, 6),
    name: cleanStr(r.name, 42) || cleanStr(r.symbol, 20) || "Token",
    image: img,
    createdAt,
    holders: optNum(r.holders ?? r.holderCount),
    top10Pct: optNum(r.top10Pct),
    burnedPct: optNum(r.burnedPct),
    priceHype,
    mcapHype,
    liquidityHype: Math.max(
      0,
      num(
        r.liquidity ??
          r.liquidityHype ??
          r.liquidityNative ??
          r.reserveHype
      )
    ),
    volume24h: Math.max(0, num(r.vol24h ?? r.volume24h)),
    volume1h: Math.max(0, num(r.vol1h ?? r.volume1h)),
    trades24h: tx24h,
    trades1h: tx1h,
    change24h: optNum(r.change24h ?? r.priceChange24h),
  };
}

async function fetchElyxaFeed(): Promise<NormalizedPair[]> {
  const [byVol, byAge, byLiq] = await Promise.all([
    fetchJson<{ pairs?: Array<Record<string, unknown>> }>(
      "https://elyxa.trade/api/pairs?launchpad=All&sort=vol24h&q=&limit=300&offset=0&window=86400",
      10_000
    ),
    fetchJson<{ pairs?: Array<Record<string, unknown>> }>(
      "https://elyxa.trade/api/pairs?launchpad=All&sort=age&q=&limit=250&offset=0&window=86400",
      10_000
    ),
    fetchJson<{ pairs?: Array<Record<string, unknown>> }>(
      "https://elyxa.trade/api/pairs?launchpad=All&sort=liquidity&q=&limit=200&offset=0&window=86400",
      10_000
    ),
  ]);

  const rawList = [
    ...(byVol?.pairs ?? []),
    ...(byAge?.pairs ?? []),
    ...(byLiq?.pairs ?? []),
  ];
  const seenPools = new Set<string>();
  const seenTokens = new Set<string>();
  const out: NormalizedPair[] = [];

  for (const r of rawList) {
    const parsed = parseElyxaPair(r);
    if (!parsed) continue;
    const dedupeKey = `${parsed.pool}:${parsed.token}`;
    if (seenPools.has(dedupeKey)) continue;
    seenPools.add(dedupeKey);
    seenTokens.add(parsed.token);
    out.push(parsed);
  }

  // Ensure every launchpad's official platform token is looked up if not in the top pages
  const missingTokens = LAUNCHPAD_REGISTRY.filter(
    (e) => e.token && !seenTokens.has(e.token.address.toLowerCase())
  ).map((e) => e.token!.address.toLowerCase());

  if (missingTokens.length > 0) {
    const extraLists = await Promise.all(
      missingTokens.map((tok) =>
        fetchJson<{ pairs?: Array<Record<string, unknown>> }>(
          `https://elyxa.trade/api/pairs?launchpad=All&sort=age&q=${tok}&limit=6&offset=0&window=86400`,
          5_000
        )
      )
    );
    for (const box of extraLists) {
      for (const r of box?.pairs ?? []) {
        const parsed = parseElyxaPair(r);
        if (!parsed) continue;
        const dedupeKey = `${parsed.pool}:${parsed.token}`;
        if (seenPools.has(dedupeKey)) continue;
        seenPools.add(dedupeKey);
        out.push(parsed);
      }
    }
  }

  return out;
}

interface RawMontraCard {
  address?: string;
  name?: string;
  symbol?: string;
  imageUrl?: string | null;
  poolId?: string | null;
  price?: string | number | null;
  marketCap?: string | number | null;
  volume24h?: string | number | null;
  volume1h?: string | number | null;
  change24hPct?: number | null;
  holders?: number;
  swaps?: number;
  launchedAt?: number;
  createdAt?: number;
}

async function fetchMontraFeed(): Promise<NormalizedPair[]> {
  const [trending, newest] = await Promise.all([
    fetchJson<{ tokens?: RawMontraCard[] }>(
      "https://api.montramarkets.xyz/api/tokens?sort=trending&limit=50",
      6_000
    ),
    fetchJson<{ tokens?: RawMontraCard[] }>(
      "https://api.montramarkets.xyz/api/tokens?sort=new&limit=30",
      6_000
    ),
  ]);

  const rawList = [...(trending?.tokens ?? []), ...(newest?.tokens ?? [])];
  const seen = new Set<string>();
  const out: NormalizedPair[] = [];

  for (const t of rawList) {
    const addr = String(t.address ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr) || seen.has(addr)) continue;
    seen.add(addr);

    const img = safeImageUrl(t.imageUrl);
    if (img) rememberLogoUrl(addr, img);

    let createdAt = optNum(t.launchedAt ?? t.createdAt);
    if (createdAt && createdAt > 1e12) createdAt = Math.floor(createdAt / 1000);

    const priceHype = Math.max(0, num(t.price));
    const mcap = Math.min(1e8, Math.max(0, num(t.marketCap)));
    // Montra returns volume24h and volume1h as 18-decimal wei strings!
    const vol24 = Math.max(0, weiToHype(t.volume24h));
    const vol1h = Math.max(0, weiToHype(t.volume1h));

    out.push({
      pool: `0xe2e105d3f7209a9da11f83ccf3e7398a753823f1:${String(t.poolId ?? addr).toLowerCase()}`,
      version: "v4",
      group: "montra",
      venue: "Montra V4",
      launchpadId: "montra",
      launchpadName: "Montra",
      hooks: "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec",
      token: addr,
      symbol: cleanStr(t.symbol, 20) || addr.slice(0, 6),
      name: cleanStr(t.name, 42) || cleanStr(t.symbol, 20) || "Montra Token",
      image: img,
      createdAt,
      holders: optNum(t.holders),
      top10Pct: null,
      burnedPct: null,
      priceHype,
      mcapHype: mcap,
      liquidityHype: mcap > 0 ? Math.max(vol24 * 0.2, mcap * 0.08) : vol24 * 0.2,
      volume24h: vol24,
      volume1h: vol1h,
      trades24h: Math.max(0, Math.round(num(t.swaps))),
      trades1h: 0,
      change24h: optNum(t.change24hPct),
    });
  }

  return out;
}

interface RawKleosItem {
  address?: string;
  symbol?: string;
  name?: string;
  image?: string;
  createdAt?: number;
  timestamp?: number;
  volumeHype?: number;
  volume24h?: number;
  mcapHype?: number;
  marketCap?: number;
  holders?: number;
}

async function fetchKleosFeed(): Promise<NormalizedPair[]> {
  const body = await fetchJson<Record<string, RawKleosItem> | RawKleosItem[]>(
    "https://www.thekleos.pro/api/board",
    6_000
  );
  if (!body) return [];
  const items = Array.isArray(body) ? body : Object.values(body);
  const out: NormalizedPair[] = [];

  for (const item of items) {
    const addr = String(item?.address ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) continue;
    const img = safeImageUrl(item.image);
    if (img) rememberLogoUrl(addr, img);

    let createdAt = optNum(item.createdAt ?? item.timestamp);
    if (createdAt && createdAt > 1e12) createdAt = Math.floor(createdAt / 1000);

    out.push({
      pool: `kleos:${addr}`,
      version: "v4",
      group: "kleos-v4",
      venue: "Kleos V4",
      launchpadId: "kleos",
      launchpadName: "Kleos",
      token: addr,
      symbol: cleanStr(item.symbol, 20) || addr.slice(0, 6),
      name: cleanStr(item.name, 42) || cleanStr(item.symbol, 20) || "Kleos Token",
      image: img,
      createdAt,
      holders: optNum(item.holders),
      top10Pct: null,
      burnedPct: null,
      priceHype: 0,
      mcapHype: Math.max(0, num(item.mcapHype ?? item.marketCap)),
      liquidityHype: 0,
      volume24h: Math.max(0, num(item.volume24h ?? item.volumeHype)),
      volume1h: 0,
      trades24h: 0,
      trades1h: 0,
      change24h: null,
    });
  }
  return out;
}

function isCountedLaunch(c: {
  liquidityHype: number;
  trades24h: number;
  mcapHype: number;
  volume24h: number;
  holders: number | null;
}): boolean {
  return (
    c.liquidityHype >= 1 ||
    c.trades24h >= 1 ||
    c.volume24h > 0 ||
    c.mcapHype >= 5 ||
    (c.holders ?? 0) >= 2
  );
}

interface RawBoxaIndexToken {
  address?: string;
  name?: string;
  symbol?: string;
  image?: string | null;
  launchpad?: string;
  createdAt?: number;
  pool?: string;
  poolVersion?: string;
  priceHype?: number;
  marketCapHype?: number;
  volumeHype?: Record<string, number>;
  changePct?: Record<string, number>;
  buys?: Record<string, number>;
  sells?: Record<string, number>;
  holders?: number;
  top10Pct?: number;
}

/** BOXA's all-token index: per-launchpad volume, market cap, trades and holders for the registry's launchpads. */
const boxaLastGood = new Map<string, RawBoxaIndexToken[]>();

async function fetchBoxaIndexFeed(): Promise<NormalizedPair[]> {
  const targets = LAUNCHPAD_REGISTRY.filter((lp) => lp.boxaIndexKey);
  const urls = targets.flatMap((lp) =>
    (["volume", "newest"] as const).map((sort) => ({
      lp,
      key: `${lp.id}:${sort}`,
      url: `https://boxa.club/api/index/tokens?launchpad=${encodeURIComponent(lp.boxaIndexKey!)}&sort=${sort}&limit=${sort === "volume" ? 60 : 24}`,
    }))
  );
  // A few requests at a time: BOXA throttles bursts. A failed list falls back to its last good copy.
  const lists: { lp: (typeof targets)[number]; tokens: RawBoxaIndexToken[] }[] = [];
  for (let i = 0; i < urls.length; i += 3) {
    const batch = await Promise.all(
      urls.slice(i, i + 3).map(async ({ lp, key, url }) => {
        const body = await fetchJson<{ tokens?: RawBoxaIndexToken[] }>(url, 8_000);
        if (Array.isArray(body?.tokens)) boxaLastGood.set(key, body.tokens);
        return { lp, tokens: boxaLastGood.get(key) ?? [] };
      })
    );
    lists.push(...batch);
  }

  const out: NormalizedPair[] = [];
  const seen = new Set<string>();
  for (const { lp, tokens } of lists) {
    for (const t of tokens) {
      const addr = String(t.address ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr) || t.launchpad !== lp.boxaIndexKey) continue;
      const key = `${lp.id}:${addr}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const img = safeImageUrl(t.image);
      if (img) rememberLogoUrl(addr, img);
      let createdAt = optNum(t.createdAt);
      if (createdAt && createdAt > 1e12) createdAt = Math.floor(createdAt / 1000);
      const v4 = String(t.poolVersion ?? "").toLowerCase() === "v4";
      const mcap = Math.max(0, num(t.marketCapHype));

      out.push({
        pool: String(t.pool ?? addr).toLowerCase(),
        version: v4 ? "v4" : "v3",
        group: lp.boxaIndexKey!,
        venue: `${lp.shortName} ${v4 ? "V4" : "V3"}`,
        launchpadId: lp.id,
        launchpadName: lp.name,
        token: addr,
        symbol: cleanStr(t.symbol, 20).replace(/^\$+/, "") || addr.slice(0, 6),
        name: cleanStr(t.name, 42) || cleanStr(t.symbol, 20) || "Token",
        image: img,
        createdAt,
        holders: optNum(t.holders),
        top10Pct: optNum(t.top10Pct),
        burnedPct: null,
        priceHype: Math.max(0, num(t.priceHype)),
        mcapHype: mcap > 1e8 ? 0 : mcap,
        liquidityHype: 0,
        volume24h: Math.max(0, num(t.volumeHype?.["24h"])),
        volume1h: Math.max(0, num(t.volumeHype?.["1h"])),
        trades24h: Math.max(0, Math.round(num(t.buys?.["24h"]) + num(t.sells?.["24h"]))),
        trades1h: Math.max(0, Math.round(num(t.buys?.["1h"]) + num(t.sells?.["1h"]))),
        change24h: optNum(t.changePct?.["24h"]),
      });
    }
  }
  return out;
}

/** Fold `extra` into `prev` (same launchpad and token): keep the larger activity numbers and fill gaps. */
function mergePair(prev: NormalizedPair, extra: NormalizedPair): void {
  prev.image ||= extra.image;
  if (!prev.symbol || prev.symbol === prev.token.slice(0, 6)) prev.symbol = extra.symbol;
  if (!prev.name || prev.name === "Token") prev.name = extra.name;
  prev.holders = Math.max(prev.holders ?? 0, extra.holders ?? 0) || prev.holders;
  prev.mcapHype = Math.max(prev.mcapHype, extra.mcapHype);
  prev.liquidityHype = Math.max(prev.liquidityHype, extra.liquidityHype);
  prev.volume24h = Math.max(prev.volume24h, extra.volume24h);
  prev.volume1h = Math.max(prev.volume1h, extra.volume1h);
  prev.trades24h = Math.max(prev.trades24h, extra.trades24h);
  prev.trades1h = Math.max(prev.trades1h, extra.trades1h);
  prev.priceHype = prev.priceHype || extra.priceHype;
  prev.change24h ??= extra.change24h;
  if (extra.createdAt && (!prev.createdAt || extra.createdAt < prev.createdAt)) prev.createdAt = extra.createdAt;
}

let boxaFeedCache: { at: number; pairs: NormalizedPair[] } | null = null;
let boxaFeedRefresh: Promise<NormalizedPair[]> | null = null;

/** BOXA index pairs: last copy right away (refreshed every minute), or up to `waitMs` for the first one. */
async function boxaIndexPairs(waitMs: number): Promise<NormalizedPair[]> {
  if (!boxaFeedCache || Date.now() - boxaFeedCache.at > 60_000) {
    boxaFeedRefresh ??= fetchBoxaIndexFeed()
      .then((pairs) => {
        boxaFeedCache = { at: Date.now(), pairs };
        return pairs;
      })
      .catch(() => boxaFeedCache?.pairs ?? [])
      .finally(() => {
        boxaFeedRefresh = null;
      });
  }
  const pairs = boxaFeedCache
    ? boxaFeedCache.pairs
    : await Promise.race([
        boxaFeedRefresh!,
        new Promise<NormalizedPair[]>((r) => setTimeout(() => r([]), waitMs)),
      ]);
  // Merging mutates pairs, so hand out copies of the cached ones.
  return pairs.map((p) => ({ ...p }));
}

type PairsSnapshot = { at: number; pairs: NormalizedPair[]; index: LaunchIndexSummary | null };
let cachedPairsSnapshot: PairsSnapshot | null = null;
let pairsRefresh: Promise<PairsSnapshot> | null = null;

/**
 * Unified pairs, cached 45s. A stale snapshot (up to 10 min) is served at once while a fresh one is built in
 * the background, so the page never waits on a slow upstream feed.
 */
async function loadPairs(env?: Env, ctx?: ExecutionContext): Promise<PairsSnapshot> {
  const cached = cachedPairsSnapshot;
  if (cached && Date.now() - cached.at < 45_000) return cached;
  pairsRefresh ??= buildPairs(env).finally(() => {
    pairsRefresh = null;
  });
  if (cached && Date.now() - cached.at < 600_000) {
    ctx?.waitUntil(pairsRefresh.catch(() => undefined));
    return cached;
  }
  return pairsRefresh;
}

async function buildPairs(env?: Env): Promise<PairsSnapshot> {

  const db = env?.DB;
  const [elyxa, montra, kleos, boxaIndex, index] = await Promise.all([
    fetchElyxaFeed().catch(() => []),
    fetchMontraFeed().catch(() => []),
    fetchKleosFeed().catch(() => []),
    boxaIndexPairs(6_000),
    db ? readLaunchIndex(db).catch(() => null) : Promise.resolve(null),
  ]);

  const feed = [...elyxa, ...montra, ...kleos, ...boxaIndex];

  // The on-chain index is the authority on where a token launched: a token launched on Ascend that later gets
  // a BOXA V3 pool still counts for Ascend. Feed rows the index does not know keep the feed's own label.
  const origin = db
    ? await launchpadsOfTokens(db, feed.map((p) => p.token)).catch(() => new Map<string, string>())
    : new Map<string, string>();

  const byTokenAndLaunchpad = new Map<string, NormalizedPair>();
  const add = (p: NormalizedPair, preferLarger: boolean) => {
    const onchainId = origin.get(p.token);
    if (onchainId && onchainId !== p.launchpadId) {
      const lp = launchpadById(onchainId);
      p.launchpadId = onchainId;
      p.launchpadName = lp?.name ?? onchainId;
      p.group = onchainId;
    }
    const key = `${p.launchpadId ?? p.group}:${p.token}`;
    const prev = byTokenAndLaunchpad.get(key);
    if (!prev) {
      byTokenAndLaunchpad.set(key, p);
    } else if (preferLarger && p.volume24h + p.liquidityHype > prev.volume24h + prev.liquidityHype) {
      mergePair(p, prev);
      byTokenAndLaunchpad.set(key, p);
    } else {
      mergePair(prev, p);
    }
  };

  // ELYXA pairs first (pool-level, best liquidity), then the launchpads' own feeds and BOXA's index fill in.
  for (const p of elyxa) add(p, true);
  for (const p of [...montra, ...kleos, ...boxaIndex]) add(p, false);

  // Newest on-chain launches of every launchpad, so each one lists its tokens even when no feed covers it.
  for (const r of index?.recent ?? []) {
    const key = `${r.launchpadId}:${r.token}`;
    const lp = launchpadById(r.launchpadId);
    const existing = byTokenAndLaunchpad.get(key);
    if (existing) {
      existing.createdAt ??= r.createdAt;
      continue;
    }
    const v4 = r.pool.includes(":");
    byTokenAndLaunchpad.set(key, {
      pool: r.pool,
      version: v4 ? "v4" : "v3",
      group: r.launchpadId,
      venue: `${lp?.shortName ?? r.launchpadId} ${v4 ? "V4" : "V3"}`,
      launchpadId: r.launchpadId,
      launchpadName: lp?.name ?? r.launchpadId,
      factory: v4 ? null : r.emitter,
      token: r.token,
      symbol: r.symbol || r.token.slice(0, 6),
      name: r.name || r.symbol || "Token",
      image: null,
      createdAt: r.createdAt,
      holders: null,
      top10Pct: null,
      burnedPct: null,
      priceHype: 0,
      mcapHype: 0,
      liquidityHype: 0,
      volume24h: 0,
      volume1h: 0,
      trades24h: 0,
      trades1h: 0,
      change24h: null,
    });
  }

  const pairs = [...byTokenAndLaunchpad.values()];
  cachedPairsSnapshot = { at: Date.now(), pairs, index };
  return cachedPairsSnapshot;
}

export async function getUnifiedLaunchpadPairs(env?: Env): Promise<NormalizedPair[]> {
  return (await loadPairs(env)).pairs;
}

export function computeLaunchpadRankings(
  pairs: NormalizedPair[],
  commentCounts: Map<string, number>,
  nowSeconds = Math.floor(Date.now() / 1000),
  index: LaunchIndexSummary | null = null
): LaunchpadRankingEntry[] {
  // Also index best stats per token across all pools so platform tokens get live metrics
  const tokenBest = new Map<string, NormalizedPair>();
  for (const p of pairs) {
    const cur = tokenBest.get(p.token);
    if (
      !cur ||
      p.liquidityHype + p.volume24h > cur.liquidityHype + cur.volume24h
    ) {
      tokenBest.set(p.token, p);
    }
  }

  const cutoff24h = nowSeconds - DAY_SECONDS;

  return LAUNCHPAD_REGISTRY.map((lp) => {
    const coinMap = new Map<string, LaunchpadCoinSummary>();

    for (const p of pairs) {
      if (NOT_LAUNCHES.has(p.token)) continue;
      const matched =
        p.launchpadId === lp.id ||
        launchpadOfPool(p.group, p.hooks, p.factory)?.id === lp.id;
      if (!matched) continue;

      const existing = coinMap.get(p.token);
      if (!existing) {
        coinMap.set(p.token, {
          address: getAddress(p.token),
          symbol: p.symbol,
          name: p.name,
          imageUrl: p.image,
          launchpadId: lp.id,
          launchpadName: lp.name,
          venue: p.venue,
          createdAt: p.createdAt,
          holders: p.holders,
          priceHype: p.priceHype,
          mcapHype: p.mcapHype,
          liquidityHype: p.liquidityHype,
          volume24h: p.volume24h,
          volume1h: p.volume1h,
          trades24h: p.trades24h,
          trades1h: p.trades1h,
          change24h: p.change24h,
          commentCount: commentCounts.get(p.token) ?? 0,
          isLaunchpadToken: launchpadTokenOf(p.token)?.id === lp.id,
        });
      } else {
        existing.volume24h += p.volume24h;
        existing.volume1h += p.volume1h;
        existing.trades24h += p.trades24h;
        existing.trades1h += p.trades1h;
        existing.liquidityHype = Math.max(
          existing.liquidityHype,
          p.liquidityHype
        );
        if (p.mcapHype > existing.mcapHype) {
          existing.mcapHype = p.mcapHype;
          existing.priceHype = p.priceHype || existing.priceHype;
        }
        if (p.holders && (!existing.holders || p.holders > existing.holders)) {
          existing.holders = p.holders;
        }
        if (
          p.createdAt &&
          (!existing.createdAt || p.createdAt < existing.createdAt)
        ) {
          existing.createdAt = p.createdAt;
        }
        existing.imageUrl ||= p.image;
      }
    }

    // Ensure the launchpad's own platform token is included if it exists
    if (lp.token) {
      const tokAddr = lp.token.address.toLowerCase();
      if (!coinMap.has(tokAddr)) {
        const best = tokenBest.get(tokAddr);
        coinMap.set(tokAddr, {
          address: getAddress(tokAddr),
          symbol: lp.token.symbol,
          name: lp.token.name,
          imageUrl: best?.image ?? null,
          launchpadId: lp.id,
          launchpadName: lp.name,
          venue: best?.venue ?? `${lp.shortName}`,
          createdAt: best?.createdAt ?? null,
          holders: best?.holders ?? null,
          priceHype: best?.priceHype ?? 0,
          mcapHype: best?.mcapHype ?? 0,
          liquidityHype: best?.liquidityHype ?? 0,
          volume24h: best?.volume24h ?? 0,
          volume1h: best?.volume1h ?? 0,
          trades24h: best?.trades24h ?? 0,
          trades1h: best?.trades1h ?? 0,
          change24h: best?.change24h ?? null,
          commentCount: commentCounts.get(tokAddr) ?? 0,
          isLaunchpadToken: true,
        });
      }
    }

    const allCoins = [...coinMap.values()];
    const indexed = index?.counts.get(lp.id) ?? null;
    const counted = allCoins.filter(isCountedLaunch);
    const displayPool = counted.length > 0 ? counted : allCoins;

    let volume24h = 0;
    let volume1h = 0;
    let trades24h = 0;
    let trades1h = 0;
    let mcapHype = 0;
    let liquidityHype = 0;
    let launches24h = 0;
    let launches10Holders = 0;
    let discussionCount = 0;

    for (const c of allCoins) {
      volume24h += c.volume24h;
      volume1h += c.volume1h;
      trades24h += c.trades24h;
      trades1h += c.trades1h;
      liquidityHype += c.liquidityHype;
      discussionCount += c.commentCount;
      if (c.createdAt && c.createdAt >= cutoff24h) launches24h++;
      if ((c.holders ?? 0) >= 10) launches10Holders++;
    }

    for (const c of counted) {
      if (c.mcapHype > 0 && c.mcapHype < 1e8) {
        mcapHype += c.mcapHype;
      }
    }

    const topCoins = [...displayPool]
      .sort(
        (a, b) =>
          b.volume24h - a.volume24h ||
          b.liquidityHype - a.liquidityHype ||
          b.mcapHype - a.mcapHype
      )
      .slice(0, 6);

    // Recent launches list every new token, traded or not.
    const newCoins = [...allCoins]
      .filter((c) => c.createdAt !== null)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 6);

    let tokenDetails: LaunchpadRankingEntry["token"] = null;
    if (lp.token) {
      const tokAddr = lp.token.address.toLowerCase();
      const c = coinMap.get(tokAddr) ?? tokenBest.get(tokAddr);
      tokenDetails = {
        ...lp.token,
        address: getAddress(tokAddr),
        priceHype: c?.priceHype ?? 0,
        mcapHype: c?.mcapHype ?? 0,
        liquidityHype: c?.liquidityHype ?? 0,
        volume24h: c?.volume24h ?? 0,
        holders: c?.holders ?? null,
        commentCount: commentCounts.get(tokAddr) ?? 0,
      };
    }

    return {
      id: lp.id,
      name: lp.name,
      shortName: lp.shortName,
      site: lp.site,
      status: lp.status,
      summary: lp.summary,
      contracts: lp.contracts,
      verifiedOnChain: lp.launchSources.length > 0,
      indexedLaunches: indexed ? indexed.launches : index ? 0 : null,
      token: tokenDetails,
      launches: Math.max(indexed?.launches ?? 0, counted.length || allCoins.length),
      launches24h: Math.max(indexed?.launches24h ?? 0, launches24h),
      launches10Holders,
      volume24h,
      volume1h,
      trades24h,
      trades1h,
      mcapHype,
      liquidityHype,
      discussionCount,
      topCoins,
      newCoins,
    };
  }).sort(
    (a, b) =>
      b.volume24h - a.volume24h ||
      b.liquidityHype - a.liquidityHype ||
      b.mcapHype - a.mcapHype ||
      b.launches - a.launches
  );
}

export async function handleLaunchpads(
  _req: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  // Advance the on-chain launch index in the background; this response uses what is already indexed.
  const sync = syncLaunchIndex(env);
  if (ctx) ctx.waitUntil(sync.catch(() => undefined));

  const [{ pairs, index }, commentRows] = await Promise.all([
    loadPairs(env, ctx),
    env.DB
      ? env.DB.prepare(
          "SELECT room_address AS token_address, COUNT(*) AS c FROM posts WHERE room_address IS NOT NULL GROUP BY room_address"
        )
          .all<{ token_address: string; c: number }>()
          .then((r) => r.results)
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const commentCounts = new Map<string, number>();
  for (const r of commentRows) {
    commentCounts.set(r.token_address.toLowerCase(), Number(r.c));
  }

  const launchpads = computeLaunchpadRankings(
    pairs,
    commentCounts,
    Math.floor(Date.now() / 1000),
    index
  );

  const totals = launchpads.reduce(
    (acc, l) => {
      acc.volume24h += l.volume24h;
      acc.volume1h += l.volume1h;
      acc.trades24h += l.trades24h;
      acc.launches += l.launches;
      acc.launches24h += l.launches24h;
      acc.liquidityHype += l.liquidityHype;
      acc.mcapHype += l.mcapHype;
      return acc;
    },
    {
      volume24h: 0,
      volume1h: 0,
      trades24h: 0,
      launches: 0,
      launches24h: 0,
      liquidityHype: 0,
      mcapHype: 0,
    }
  );

  return new Response(
    JSON.stringify({
      launchpads,
      totals,
      updatedAt: Date.now(),
      chainId: 99901,
      launchIndex: index
        ? { indexedLaunches: index.rows, lagBlocks: index.lagBlocks }
        : null,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=20, stale-while-revalidate=60",
      },
    }
  );
}

export interface CandlePoint {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 5-Tier Candle Cascade for fast, deep token price charts across all Elysium launchpads:
 *   1. Montra candles (api.montramarkets.xyz/api/tokens/:addr/candles?interval=5m|1h|1d)
 *   2. ELYXA pool candles (elyxa.trade/api/pairs/:pool/candles?res=5m|1h|1d)
 *   3. BOXA token candles (boxa.club/api/markets/:addr/candles?interval=5m|1h|1d)
 *   4. Kleos trade index (www.thekleos.pro/api/trades/:addr) bucketed into OHLCV
 */
export async function handleCandles(
  req: Request,
  _env: Env,
  address: string
): Promise<Response> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ error: "Invalid token address." }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  const url = new URL(req.url);
  const resParam = url.searchParams.get("res") ?? "15m";
  const bucketSec =
    resParam === "1m"
      ? 60
      : resParam === "5m"
        ? 300
        : resParam === "1h"
          ? 3600
          : resParam === "1d"
            ? 86400
            : 900;
  const stdInterval: "5m" | "1h" | "1d" =
    bucketSec <= 900 ? "5m" : bucketSec <= 3600 ? "1h" : "1d";

  // Tier 1: Montra candles (/api/tokens/:addr/candles?interval=5m|1h|1d)
  const montraData = await fetchJson<{
    candles?: Array<{
      t?: number;
      time?: number;
      open?: string | number;
      high?: string | number;
      low?: string | number;
      close?: string | number;
      volumeQuote?: string | number;
      volume?: string | number;
    }>;
  }>(
    `https://api.montramarkets.xyz/api/tokens/${addr}/candles?interval=${stdInterval}&limit=240`,
    3_200
  );
  if (montraData?.candles && montraData.candles.length >= 2) {
    const candles: CandlePoint[] = [];
    for (const c of montraData.candles) {
      let time = num(c.t ?? c.time);
      if (time > 1e12) time = Math.floor(time / 1000);
      const open = num(c.open);
      const close = num(c.close);
      const high = Math.max(open, close, num(c.high));
      const low = Math.min(open, close, num(c.low) || open);
      const vol =
        c.volumeQuote !== undefined ? weiToHype(c.volumeQuote) : num(c.volume);
      if (time > 0 && close > 0) {
        candles.push({ time, open: open || close, high, low, close, volume: vol });
      }
    }
    if (candles.length >= 2) {
      return jsonCandles(
        candles.sort((a, b) => a.time - b.time),
        "Montra Markets"
      );
    }
  }

  // Tier 2: ELYXA pool candles (elyxa.trade/api/pairs/:pool/candles?res=5m|1h|1d)
  const elyxaPairs = await fetchJson<{ pairs?: Array<Record<string, unknown>> }>(
    `https://elyxa.trade/api/pairs?launchpad=All&sort=age&q=${addr}&limit=10&offset=0&window=86400`,
    4_000
  );
  const matchingPairs = (elyxaPairs?.pairs ?? [])
    .map(parseElyxaPair)
    .filter((p): p is NormalizedPair => Boolean(p) && p!.token === addr)
    .sort((a, b) => b.liquidityHype - a.liquidityHype);

  const bestPair = matchingPairs[0];
  if (bestPair?.pool) {
    const elyxaCandleData = await fetchJson<{
      candles?: Array<Record<string, unknown>>;
    }>(
      `https://elyxa.trade/api/pairs/${encodeURIComponent(bestPair.pool)}/candles?res=${stdInterval}`,
      4_000
    );
    if (elyxaCandleData?.candles && elyxaCandleData.candles.length >= 2) {
      const candles = normalizeCandles(elyxaCandleData.candles);
      if (candles.length >= 2) {
        return jsonCandles(candles, `ELYXA (${bestPair.venue})`);
      }
    }
  }

  // Tier 3: BOXA candles (boxa.club/api/markets/:addr/candles?interval=5m|1h|1d&since=...)
  const span =
    stdInterval === "5m"
      ? 86_400 * 1.5
      : stdInterval === "1h"
        ? 86_400 * 16
        : 86_400 * 120;
  const since = Math.floor(Date.now() / 1000 - span);
  const boxaData = await fetchJson<{
    candles?: Array<Record<string, unknown>>;
  }>(
    `https://boxa.club/api/markets/${addr}/candles?interval=${stdInterval}&since=${since}`,
    3_500
  );
  if (boxaData?.candles && boxaData.candles.length >= 2) {
    const candles = normalizeCandles(boxaData.candles);
    if (candles.length >= 2) {
      return jsonCandles(candles, "BOXA");
    }
  }

  // Tier 4: Kleos trade history bucketed into OHLCV
  const kleosTrades = await fetchJson<
    Array<{
      timestamp?: number;
      time?: number;
      price?: number;
      priceHype?: number;
      amountHype?: number;
      ethAmount?: number;
    }>
  >(`https://www.thekleos.pro/api/trades/${addr}`, 3_200);
  if (Array.isArray(kleosTrades) && kleosTrades.length >= 2) {
    const buckets = new Map<number, CandlePoint>();
    for (const t of kleosTrades) {
      let ts = num(t.timestamp ?? t.time);
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      const price = num(t.priceHype ?? t.price);
      const vol = Math.abs(num(t.amountHype ?? t.ethAmount));
      if (!(ts > 0 && price > 0)) continue;
      const b = Math.floor(ts / bucketSec) * bucketSec;
      const prev = buckets.get(b);
      if (!prev) {
        buckets.set(b, {
          time: b,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: vol,
        });
      } else {
        prev.high = Math.max(prev.high, price);
        prev.low = Math.min(prev.low, price);
        prev.close = price;
        prev.volume += vol;
      }
    }
    const candles = [...buckets.values()].sort((a, b) => a.time - b.time);
    if (candles.length >= 2) {
      return jsonCandles(candles, "Kleos Trades");
    }
  }

  return jsonCandles([], null);
}

function normalizeCandles(
  raw: Array<Record<string, unknown>>
): CandlePoint[] {
  const out: CandlePoint[] = [];
  for (const c of raw) {
    let time = num(c.time ?? c.timestamp ?? c.t ?? c.bucket);
    if (time > 1e12) time = Math.floor(time / 1000);
    const open = num(c.open ?? c.o);
    const close = num(c.close ?? c.c ?? open);
    const high = Math.max(open, close, num(c.high ?? c.h));
    const lowRaw = num(c.low ?? c.l);
    const low =
      lowRaw > 0 ? Math.min(open, close, lowRaw) : Math.min(open, close);
    const volume = Math.max(0, num(c.volume ?? c.volumeHype ?? c.v ?? c.vol));
    if (time > 0 && close > 0) {
      out.push({ time, open: open || close, high, low, close, volume });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

function jsonCandles(candles: CandlePoint[], source: string | null): Response {
  return new Response(
    JSON.stringify({ candles, source, updatedAt: Date.now() }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=15, stale-while-revalidate=45",
      },
    }
  );
}

export { launchpadById };
