// Live Elysium 99901 token directory (/api/tokens), HYPE/USD price (/api/price), and per-token on-chain summary (/api/token-meta/:addr).
// Combines:
//   1. SEEDED_TOKENS (verified ecosystem & launchpad tokens: KNTQ, BOXA, KLEOS, ELYXA, OBOL, EOS, RONS)
//   2. Live V3 WHYPE pools across 7 V3 factories
//   3. Active V4 native-HYPE pools across 6 V4 PoolManagers
//   4. Kleos board coins
//   5. Community discussion & sentiment counts from D1 / SocialStore
import { encodeAbiParameters, getAddress, keccak256, pad, parseAbi, parseAbiParameters, type Hex } from "viem";
import { SEEDED_TOKENS } from "../src/config/tokens.ts";
import { V4_MANAGERS } from "../src/config/v4.ts";
import { V3_VENUES } from "../src/config/venues.ts";
import type { Env } from "./env.ts";
import { cacheGet, cachePut } from "./kvcache.ts";
import { call, multicall } from "./rpc.ts";

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const MANAGER = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

const TOPIC_POOL_CREATED = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
const TOPIC_V4_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const TOPIC_V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const NATIVE_TOPIC = pad("0x0", { size: 32 });
const V4_LOOKBACK_BLOCKS = 6_000;
const MAX_V4_ACTIVE = 80;
const Q96 = 2n ** 96n;

export interface DirectoryToken {
  address: string;
  symbol: string;
  name: string;
  launchpad: string;
  launchpadUrl: string;
  venueBadge: string;
  description: string;
  featured: boolean;
  hypeDepth: number;
  recentSwaps: number;
  sources: string[];
  commentCount: number;
  bullishCount: number;
  bearishCount: number;
  avgRating: number;
  ratingCount: number;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
}

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, 44);

function stateSlot(id: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [id, 6n])));
}
const word = (s: bigint) => pad(`0x${s.toString(16)}`, { size: 32 });

async function scanV3Pools(env: Env): Promise<{ token: string; venue: string; depth: number }[]> {
  const pools: { pool: string; token: string; whype: string; venue: string }[] = [];
  const venueByFactory = new Map(V3_VENUES.map((v) => [v.factory.toLowerCase(), v]));
  try {
    const logs = await call<RawLog[]>(env, "eth_getLogs", [
      {
        address: V3_VENUES.map((v) => v.factory),
        topics: [TOPIC_POOL_CREATED],
        fromBlock: "0x0",
        toBlock: "latest",
      },
    ]);
    for (const l of logs) {
      const v = venueByFactory.get(String(l.address || "").toLowerCase());
      if (!v || !Array.isArray(l.topics) || l.topics.length < 3) continue;
      const t0 = `0x${l.topics[1].slice(26)}`.toLowerCase();
      const t1 = `0x${l.topics[2].slice(26)}`.toLowerCase();
      const w = v.whype.toLowerCase();
      if (t0 !== w && t1 !== w) continue;
      pools.push({
        pool: `0x${l.data.slice(2 + 64 + 24, 2 + 128)}`,
        token: t0 === w ? t1 : t0,
        whype: w,
        venue: v.name,
      });
    }
  } catch {
    /* fallback if batch factory log query fails */
  }
  if (!pools.length) return [];
  const bals = await multicall<bigint>(
    env,
    pools.map((p) => ({ target: p.whype, abi: ERC20, functionName: "balanceOf", args: [p.pool] })),
  );
  return pools.map((p, i) => ({
    token: p.token,
    venue: p.venue,
    depth: Number(bals[i] ?? 0n) / 1e18,
  }));
}

async function scanActiveV4(env: Env): Promise<{ token: string; swaps: number; depth: number; managerName: string }[]> {
  const latest = parseInt(await call<string>(env, "eth_blockNumber", []), 16);
  const managers = V4_MANAGERS.map((m) => m.poolManager);
  const from = Math.max(0, latest - V4_LOOKBACK_BLOCKS);
  const swaps = await call<RawLog[]>(env, "eth_getLogs", [
    {
      address: managers,
      topics: [TOPIC_V4_SWAP],
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
    },
  ]);
  const count = new Map<string, { manager: string; n: number }>();
  for (const l of swaps) {
    const id = l.topics[1]?.toLowerCase();
    if (!id) continue;
    const c = count.get(id);
    if (c) c.n++;
    else count.set(id, { manager: l.address.toLowerCase(), n: 1 });
  }
  const ranked = [...count.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_V4_ACTIVE);
  if (!ranked.length) return [];
  const ids = ranked.map(([id]) => id);
  const inits = await call<RawLog[]>(env, "eth_getLogs", [
    { address: managers, topics: [TOPIC_V4_INITIALIZE, ids, NATIVE_TOPIC], fromBlock: "0x0", toBlock: `0x${latest.toString(16)}` },
  ]);
  const keyOf = new Map<string, string>();
  for (const l of inits) {
    if (l.topics.length === 4) keyOf.set(l.topics[1].toLowerCase(), `0x${l.topics[3].slice(26)}`.toLowerCase());
  }
  const found = ranked.filter(([id]) => keyOf.has(id));
  if (!found.length) return [];
  const state = await multicall<Hex>(
    env,
    found.flatMap(([id, c]) => {
      const s = stateSlot(id as Hex);
      return [
        { target: c.manager, abi: MANAGER, functionName: "extsload", args: [word(s)] },
        { target: c.manager, abi: MANAGER, functionName: "extsload", args: [word(s + 3n)] },
      ];
    }),
  );
  return found.map(([id, c], i) => {
    const sqrtP = BigInt(state[i * 2] ?? "0x0") & ((1n << 160n) - 1n);
    const liq = BigInt(state[i * 2 + 1] ?? "0x0") & ((1n << 128n) - 1n);
    const mgr = V4_MANAGERS.find((m) => m.poolManager.toLowerCase() === c.manager)?.name ?? "Uniswap V4";
    return {
      token: keyOf.get(id)!,
      swaps: c.n,
      depth: sqrtP > 0n ? Number((liq * Q96) / sqrtP) / 1e18 : 0,
      managerName: mgr,
    };
  });
}

async function fetchKleosBoard(): Promise<{ token: string; symbol: string; name: string }[]> {
  const res = await fetch("https://www.thekleos.pro/api/board", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Kleos HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  const out: { token: string; symbol: string; name: string }[] = [];
  for (const item of Object.values(body ?? {}) as { address?: unknown; symbol?: unknown; name?: unknown }[]) {
    if (typeof item?.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(item.address)) continue;
    out.push({ token: item.address.toLowerCase(), symbol: clean(item.symbol), name: clean(item.name) });
  }
  return out;
}

interface RawChainEntry {
  address: string;
  symbol: string;
  name: string;
  launchpad: string;
  launchpadUrl: string;
  venueBadge: string;
  description: string;
  featured: boolean;
  hypeDepth: number;
  recentSwaps: number;
  sources: string[];
}

let cachedChainScan: { at: number; items: RawChainEntry[] } | null = null;

async function getChainDirectory(env: Env): Promise<RawChainEntry[]> {
  if (cachedChainScan && Date.now() - cachedChainScan.at < 300_000) {
    return cachedChainScan.items;
  }

  const by = new Map<string, RawChainEntry>();
  for (const s of SEEDED_TOKENS) {
    by.set(s.address.toLowerCase(), {
      address: getAddress(s.address),
      symbol: s.symbol,
      name: s.name,
      launchpad: s.launchpad,
      launchpadUrl: s.launchpadUrl,
      venueBadge: s.venueBadge,
      description: s.description,
      featured: s.featured,
      hypeDepth: 0,
      recentSwaps: 0,
      sources: ["seeded"],
    });
  }

  const [v3, v4, kleos] = await Promise.all([
    scanV3Pools(env).catch(() => []),
    scanActiveV4(env).catch(() => []),
    fetchKleosBoard().catch(() => []),
  ]);

  const ensure = (addr: string): RawChainEntry => {
    const k = addr.toLowerCase();
    let e = by.get(k);
    if (!e) {
      e = {
        address: getAddress(addr),
        symbol: "",
        name: "",
        launchpad: "Elysium",
        launchpadUrl: "https://elyscan.live",
        venueBadge: "Elysium Pool",
        description: "Discovered on Elysium 99901 liquidity pools.",
        featured: false,
        hypeDepth: 0,
        recentSwaps: 0,
        sources: [],
      };
      by.set(k, e);
    }
    return e;
  };

  for (const p of v3) {
    if (p.depth <= 0.01) continue;
    const e = ensure(p.token);
    e.hypeDepth = Math.max(e.hypeDepth, p.depth);
    if (!e.sources.includes("v3")) e.sources.push("v3");
    if (!e.featured) e.venueBadge = p.venue;
  }

  for (const p of v4) {
    const e = ensure(p.token);
    e.hypeDepth = Math.max(e.hypeDepth, p.depth);
    e.recentSwaps += p.swaps;
    if (!e.sources.includes("v4")) e.sources.push("v4");
    if (!e.featured) e.venueBadge = p.managerName;
  }

  for (const k of kleos.slice(0, 60)) {
    const e = ensure(k.token);
    e.symbol ||= k.symbol;
    e.name ||= k.name;
    if (!e.featured) {
      e.launchpad = "Kleos";
      e.launchpadUrl = "https://www.thekleos.pro";
    }
    if (!e.sources.includes("kleos")) e.sources.push("kleos");
  }

  // Fill missing symbol/name via Multicall3 for the top candidates
  const candidates = [...by.values()]
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.hypeDepth - a.hypeDepth || b.recentSwaps - a.recentSwaps)
    .slice(0, 80);

  const needMeta = candidates.filter((c) => !c.symbol || !c.name);
  if (needMeta.length > 0) {
    try {
      const meta = await multicall<string>(
        env,
        needMeta.flatMap((c) => [
          { target: c.address, abi: ERC20, functionName: "symbol" },
          { target: c.address, abi: ERC20, functionName: "name" },
        ]),
      );
      needMeta.forEach((c, i) => {
        c.symbol ||= clean(meta[i * 2]) || c.address.slice(0, 6);
        c.name ||= clean(meta[i * 2 + 1]) || c.symbol;
      });
    } catch {
      needMeta.forEach((c) => {
        c.symbol ||= c.address.slice(0, 6);
        c.name ||= c.symbol;
      });
    }
  }

  cachedChainScan = { at: Date.now(), items: candidates };
  return candidates;
}

export async function handleTokens(req: Request, env: Env): Promise<Response> {
  const base = await getChainDirectory(env);

  // Enrich with real-time community discussion and vote counts from D1 / SocialStore
  const commentCounts = new Map<string, number>();
  const voteStats = new Map<string, { bullish: number; bearish: number; ratingSum: number; ratingCount: number }>();

  if (env.DB) {
    const [commentsRes, votesRes] = await Promise.all([
      env.DB.prepare("SELECT room_address AS token_address, COUNT(*) AS c FROM posts WHERE room_address IS NOT NULL GROUP BY room_address").all<{
        token_address: string;
        c: number;
      }>(),
      env.DB.prepare("SELECT token_address, rating, sentiment FROM token_votes ORDER BY updated_at DESC LIMIT 5000").all<{
        token_address: string;
        rating: number | null;
        sentiment: string | null;
      }>(),
    ]);

    for (const r of commentsRes.results) {
      commentCounts.set(r.token_address.toLowerCase(), Number(r.c));
    }
    for (const v of votesRes.results) {
      const k = v.token_address.toLowerCase();
      let st = voteStats.get(k);
      if (!st) {
        st = { bullish: 0, bearish: 0, ratingSum: 0, ratingCount: 0 };
        voteStats.set(k, st);
      }
      if (v.sentiment === "bullish") st.bullish++;
      if (v.sentiment === "bearish") st.bearish++;
      if (typeof v.rating === "number" && v.rating >= 1 && v.rating <= 5) {
        st.ratingSum += v.rating;
        st.ratingCount++;
      }
    }
  }

  const tokens: DirectoryToken[] = base.map((item) => {
    const k = item.address.toLowerCase();
    const vs = voteStats.get(k);
    return {
      ...item,
      commentCount: commentCounts.get(k) ?? 0,
      bullishCount: vs?.bullish ?? 0,
      bearishCount: vs?.bearish ?? 0,
      avgRating: vs && vs.ratingCount > 0 ? Math.round((vs.ratingSum / vs.ratingCount) * 10) / 10 : 0,
      ratingCount: vs?.ratingCount ?? 0,
    };
  });

  return new Response(JSON.stringify({ tokens, updatedAt: Date.now(), chainId: 99901 }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=15, stale-while-revalidate=60",
    },
  });
}

export async function handlePrice(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = `${new URL(req.url).origin}/__price/v1`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;

  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
      signal: AbortSignal.timeout(7_000),
    });
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`);
    const mids = (await res.json()) as Record<string, string>;
    const hypeUsd = Number(mids.HYPE);
    if (!(hypeUsd > 0)) throw new Error("No HYPE mid");
    const out = new Response(
      JSON.stringify({ hypeUsd, at: Date.now(), source: "Hyperliquid allMids (HYPE mid)" }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=30",
        },
      },
    );
    cachePut(env, ctx, key, out);
    return out;
  } catch (e) {
    return new Response(JSON.stringify({ hypeUsd: null, error: (e as Error).message }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}

export async function handleTokenMeta(req: Request, env: Env, address: string): Promise<Response> {
  const raw = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) {
    return new Response(JSON.stringify({ error: "Invalid contract address." }), {
      status: 400,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const seeded = SEEDED_TOKENS.find((t) => t.address.toLowerCase() === raw);
  try {
    const [symbol, name, totalSupply, decimals] = await multicall<string | bigint | number>(env, [
      { target: raw, abi: ERC20, functionName: "symbol" },
      { target: raw, abi: ERC20, functionName: "name" },
      { target: raw, abi: ERC20, functionName: "totalSupply" },
      { target: raw, abi: ERC20, functionName: "decimals" },
    ]);
    return new Response(
      JSON.stringify({
        address: getAddress(raw),
        symbol: clean(symbol) || seeded?.symbol || raw.slice(0, 6),
        name: clean(name) || seeded?.name || "Unknown Token",
        totalSupply: (totalSupply ?? 0n).toString(),
        decimals: Number(decimals ?? 18),
        launchpad: seeded?.launchpad ?? "Elysium",
        launchpadUrl: seeded?.launchpadUrl ?? `https://elyscan.live/token/${raw}`,
        venueBadge: seeded?.venueBadge ?? "Elysium 99901",
        description: seeded?.description ?? "ERC-20 token contract on Elysium (chain 99901).",
        featured: !!seeded?.featured,
      }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=120",
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        address: getAddress(raw),
        symbol: seeded?.symbol ?? raw.slice(0, 6),
        name: seeded?.name ?? "Unknown Token",
        totalSupply: "0",
        decimals: 18,
        launchpad: seeded?.launchpad ?? "Elysium",
        launchpadUrl: seeded?.launchpadUrl ?? `https://elyscan.live/token/${raw}`,
        venueBadge: seeded?.venueBadge ?? "Elysium 99901",
        description: seeded?.description ?? "ERC-20 token contract on Elysium (chain 99901).",
        featured: !!seeded?.featured,
        rpcWarning: (e as Error).message,
      }),
      {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    );
  }
}
