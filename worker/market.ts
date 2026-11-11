// GET /api/market/:address?res=1m|15m|1h — a token's market read from Elysium itself.
//
// Pools: every HYPE (native or WHYPE) pool of the token on the V4 PoolManagers in src/config/v4.ts (Initialize events
// filtered by the token's topic) and on the V3 factories in src/config/venues.ts (PoolCreated filtered the same way).
// Price: the current sqrtPrice of the deepest pool (V4 state through extsload, V3 slot0), so it is the price a trade
// would see now. Market cap: price × (totalSupply − tokens at the dead and zero addresses); FDV: price × totalSupply;
// USD via the HYPE mid from /api/price. Candles: 1-minute bars folded from Swap logs with the chain's own block
// timestamps. Public nodes cap a getLogs at 10,000 blocks or 10,000 logs, so the history is kept per token in the edge
// cache and grown a few pages per request: new blocks first, then older ones back to the pools' creation.
import { encodeAbiParameters, keccak256, parseAbi, type Abi } from "viem";
import { V3_POOL_CREATED_TOPIC, V3_SWAP_TOPIC, V3_VENUES } from "../src/config/venues.ts";
import { V4_INITIALIZE_TOPIC, V4_MANAGERS, V4_SWAP_TOPIC } from "../src/config/v4.ts";
import { HOOKS } from "./elywake/labels.ts";
import { healthyUpstreams, hypeUsdOf } from "./elywake/feed.ts";
import type { Env } from "./env.ts";
import { cacheGet, cachePut } from "./kvcache.ts";
import { multicall, type WCall } from "./rpc.ts";
import { decodeSwap, foldBars, hypeDepthFromLiquidity, marketCaps, priceFromSqrt, resample, type Bar, type PoolRef, type SwapPoint } from "./marketCore.ts";

const NATIVE = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const HYPES = new Set([NATIVE, ...V3_VENUES.map((v) => v.whype.toLowerCase())]);
const POOLS_TTL = 10 * 60_000;
const MAX_BARS = 7 * 24 * 60; // one week of minutes
const FORWARD_PAGES = 3;
const BACK_PAGES = 2;
const MAX_TRIES = 8; // per direction: halving a range that held too many logs does not count as a page
const GROW_BUDGET_MS = 5_000; // history paging per request; the rest continues on the next one (the store keeps it)
const INITIAL_SPAN = 40_000; // ~1.5 hours of blocks for a token seen for the first time
const PRICE_SHARE = 0.1; // pools with under 10% of the deepest pool's HYPE count for volume, not for the price line
const RES = { "1m": 60, "15m": 900, "1h": 3600 } as const;
const RES_WINDOW = { "1m": 24 * 3600, "15m": 7 * 24 * 3600, "1h": Infinity } as const;
type Res = keyof typeof RES;

const STATE_ABI = parseAbi(["function extsload(bytes32[] slots) view returns (bytes32[])"]) as Abi;
const SLOT0_ABI = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96)", "function liquidity() view returns (uint128)"]) as Abi;
const ERC20_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]) as Abi;

interface Store {
  /** v2: v1 stores could hold bars priced at the sqrtPrice limit (drained pools); bumping drops them for a rebuild. */
  v: 2;
  pools: PoolRef[];
  /** Earliest pool creation block: the history is complete once `from` reaches it. */
  born: number;
  poolsAt: number;
  from: number;
  to: number;
  span: number;
  bars: Bar[];
  swaps: SwapPoint[];
}

export interface MarketPool {
  venue: string;
  kind: "v4" | "v3";
  id: string;
  priceHype: number | null;
  depthHype: number;
  priced: boolean;
}

export interface MarketResponse {
  address: string;
  decimals: number;
  priceHype: number | null;
  priceUsd: number | null;
  hypeUsd: number | null;
  totalSupply: number;
  burned: number;
  circulating: number;
  mcapHype: number | null;
  mcapUsd: number | null;
  fdvHype: number | null;
  fdvUsd: number | null;
  liquidityHype: number;
  /** HYPE traded in the last 24 hours across every pool; null until the stored history reaches back 24 hours. */
  volume24hHype: number | null;
  pools: MarketPool[];
  res: Res;
  bars: Bar[];
  swaps: SwapPoint[];
  coverage: { fromBlock: number; toBlock: number; complete: boolean };
  updatedAt: number;
}

const json = (body: unknown, status = 200, maxAge = 15) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": status === 200 ? `public, max-age=${maxAge}` : "no-store" },
  });

const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const unpad = (w: string) => `0x${w.slice(-40)}`.toLowerCase();

/* ───────── JSON-RPC with per-item errors (paging needs to tell "too many logs" from "range too wide") ───────── */

type Item<T> = { result?: T; error?: { message?: string } };
let rid = 1;

async function batchOn<T>(url: string, calls: { method: string; params: unknown[] }[]): Promise<Item<T>[] | null> {
  try {
    const reqs = calls.map((c) => ({ jsonrpc: "2.0", id: rid++, method: c.method, params: c.params }));
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reqs), signal: AbortSignal.timeout(9_000) });
    if (!res.ok) return null;
    const arr = (await res.json()) as (Item<T> & { id: number })[];
    if (!Array.isArray(arr)) return null;
    const byId = new Map(arr.map((r) => [r.id, r]));
    return reqs.map((r) => byId.get(r.id) ?? { error: { message: "missing" } });
  } catch {
    return null;
  }
}

const TOO_MANY = /count limit|too many results|more than \d+ results|narrow down|response size/i;

type LogLike = { address: string; topics: string[]; data: string; blockNumber: string; logIndex: string; transactionHash: string; blockTimestamp?: string };
type Range = { logs: LogLike[] } | { tooMany: true } | { narrow: true } | { failed: string };

/** All the given getLogs filters over one block range, answered by one node (so the pages stay consistent). */
async function logsInRange(env: Env, filters: Record<string, unknown>[], from: number, to: number): Promise<Range> {
  const calls = filters.map((f) => ({ method: "eth_getLogs", params: [{ ...f, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] }));
  let narrow = false;
  let last = "no upstream answered";
  for (const url of healthyUpstreams(env)) {
    const items = await batchOn<LogLike[]>(url, calls);
    if (!items) continue;
    const errs = items.map((i) => i.error?.message).filter(Boolean) as string[];
    if (!errs.length) return { logs: items.flatMap((i) => i.result ?? []) };
    if (errs.some((e) => TOO_MANY.test(e))) return { tooMany: true };
    narrow = true; // a block-range cap on this node; another may allow the range
    last = errs[0];
  }
  return narrow ? { narrow: true } : { failed: last };
}

/* ───────── pools ───────── */

async function discoverPools(env: Env, token: string): Promise<{ pools: PoolRef[]; born: number } | null> {
  const t = pad(token);
  const managers = V4_MANAGERS.map((m) => m.poolManager);
  const factories = V3_VENUES.map((v) => v.factory);
  const filters = [
    { address: managers, topics: [V4_INITIALIZE_TOPIC, null, null, t] },
    { address: managers, topics: [V4_INITIALIZE_TOPIC, null, t] },
    { address: factories, topics: [V3_POOL_CREATED_TOPIC, t] },
    { address: factories, topics: [V3_POOL_CREATED_TOPIC, null, t] },
  ].map((f) => ({ method: "eth_getLogs", params: [{ ...f, fromBlock: "0x0", toBlock: "latest" }] }));
  for (const url of healthyUpstreams(env)) {
    const items = await batchOn<LogLike[]>(url, filters);
    if (!items || items.some((i) => i.error)) continue;
    const pools: PoolRef[] = [];
    let born = Infinity;
    const [v4a, v4b, v3a, v3b] = items.map((i) => i.result ?? []);
    for (const l of [...v4a, ...v4b]) {
      const c0 = unpad(l.topics[2]);
      const c1 = unpad(l.topics[3]);
      const hypeIsC0 = c1 === token;
      if (!HYPES.has(hypeIsC0 ? c0 : c1)) continue;
      const mgr = l.address.toLowerCase();
      const hook = `0x${l.data.slice(2 + 128 + 24, 2 + 192)}`.toLowerCase();
      const venue = HOOKS.get(hook as never) ?? V4_MANAGERS.find((m) => m.poolManager.toLowerCase() === mgr)?.shortName ?? "V4";
      pools.push({ kind: "v4", address: mgr, id: l.topics[1].toLowerCase(), hypeIsC0, venue, hypeToken: hypeIsC0 ? c0 : c1 });
      born = Math.min(born, parseInt(l.blockNumber, 16));
    }
    for (const l of [...v3a, ...v3b]) {
      const t0 = unpad(l.topics[1]);
      const t1 = unpad(l.topics[2]);
      const hypeIsC0 = t1 === token;
      const other = hypeIsC0 ? t0 : t1;
      const venue = V3_VENUES.find((v) => v.factory.toLowerCase() === l.address.toLowerCase());
      if (!venue || other !== venue.whype.toLowerCase()) continue;
      const pool = `0x${l.data.slice(2 + 64 + 24, 2 + 128)}`.toLowerCase();
      pools.push({ kind: "v3", address: pool, id: pool, hypeIsC0, venue: venue.shortName, hypeToken: other });
      born = Math.min(born, parseInt(l.blockNumber, 16));
    }
    return { pools, born: Number.isFinite(born) ? born : 0 };
  }
  return null;
}

/** V4 pool state lives in PoolManager storage: pools mapping at slot 6, slot0 first, liquidity three slots later. */
function v4Slots(id: string): [`0x${string}`, `0x${string}`] {
  const base = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id as `0x${string}`, 6n])));
  const hex = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}` as `0x${string}`;
  return [hex(base), hex(base + 3n)];
}

interface Facts {
  pools: MarketPool[];
  priceHype: number | null;
  decimals: number;
  totalSupply: bigint;
  burned: bigint;
}

async function readFacts(env: Env, token: string, pools: PoolRef[]): Promise<Facts> {
  const calls: WCall[] = [
    { target: token, abi: ERC20_ABI, functionName: "totalSupply" },
    { target: token, abi: ERC20_ABI, functionName: "decimals" },
    { target: token, abi: ERC20_ABI, functionName: "balanceOf", args: [DEAD] },
    { target: token, abi: ERC20_ABI, functionName: "balanceOf", args: [NATIVE] },
  ];
  for (const p of pools) {
    if (p.kind === "v4") calls.push({ target: p.address, abi: STATE_ABI, functionName: "extsload", args: [v4Slots(p.id)] });
    else {
      calls.push({ target: p.address, abi: SLOT0_ABI, functionName: "slot0" });
      calls.push({ target: p.hypeToken, abi: ERC20_ABI, functionName: "balanceOf", args: [p.address] });
    }
  }
  const r = await multicall<unknown>(env, calls);
  const big = (v: unknown) => (typeof v === "bigint" ? v : 0n);
  const totalSupply = big(r[0]);
  const decimals = typeof r[1] === "number" ? r[1] : Number(r[1] ?? 18);
  const burned = big(r[2]) + big(r[3]);
  let k = 4;
  const out: MarketPool[] = [];
  for (const p of pools) {
    let sqrt = 0n;
    let depth = 0;
    if (p.kind === "v4") {
      const words = r[k++] as readonly string[] | null;
      if (words && words.length === 2) {
        sqrt = BigInt(words[0]) & ((1n << 160n) - 1n);
        depth = hypeDepthFromLiquidity(BigInt(words[1]) & ((1n << 128n) - 1n), sqrt, p.hypeIsC0);
      }
    } else {
      sqrt = big(r[k++]);
      depth = Number(big(r[k++])) / 1e18;
    }
    const price = priceFromSqrt(sqrt, p.hypeIsC0, decimals);
    out.push({ venue: p.venue, kind: p.kind, id: p.id, priceHype: price > 0 && Number.isFinite(price) ? price : null, depthHype: depth, priced: false });
  }
  const deepest = Math.max(0, ...out.filter((p) => p.priceHype).map((p) => p.depthHype));
  for (const p of out) p.priced = !!p.priceHype && deepest > 0 && p.depthHype >= deepest * PRICE_SHARE;
  const ref = out.filter((p) => p.priceHype && p.depthHype === deepest)[0];
  return { pools: out, priceHype: ref?.priceHype ?? null, decimals, totalSupply, burned };
}

/* ───────── history ───────── */

function swapFilters(pools: PoolRef[]): Record<string, unknown>[] {
  const v4 = pools.filter((p) => p.kind === "v4");
  const v3 = pools.filter((p) => p.kind === "v3");
  const out: Record<string, unknown>[] = [];
  if (v4.length) out.push({ address: [...new Set(v4.map((p) => p.address))], topics: [V4_SWAP_TOPIC, v4.map((p) => p.id)] });
  if (v3.length) out.push({ address: v3.map((p) => p.address), topics: [V3_SWAP_TOPIC] });
  return out;
}

function decodeAll(logs: LogLike[], pools: PoolRef[], priced: Set<string>, decimals: number): SwapPoint[] {
  const byKey = new Map<string, PoolRef>();
  for (const p of pools) byKey.set(p.kind === "v4" ? `${p.address}:${p.id}` : p.address, p);
  const out: SwapPoint[] = [];
  for (const l of logs) {
    const addr = l.address.toLowerCase();
    const p = l.topics[0] === V4_SWAP_TOPIC ? byKey.get(`${addr}:${l.topics[1]?.toLowerCase()}`) : byKey.get(addr);
    if (!p) continue;
    const s = decodeSwap(l, p, decimals, priced.has(p.id));
    if (s) out.push(s);
  }
  return out;
}

async function grow(env: Env, st: Store, head: number, priced: Set<string>, decimals: number): Promise<Store> {
  const filters = swapFilters(st.pools);
  if (!filters.length) return { ...st, from: head + 1, to: head };
  const deadline = Date.now() + GROW_BUDGET_MS;
  let { span } = st;
  let ceiling = Infinity; // a span a node already said holds too many logs: never ask for it again this request
  const shrink = () => {
    ceiling = Math.min(ceiling, span);
    span = Math.max(200, Math.floor(span / 2));
  };
  const widen = (count: number) => {
    if (count < 2_500) span = Math.min(span * 2, ceiling - 1, 2_000_000);
  };

  // New blocks first, so the chart and the latest swaps are current. A store too far behind to catch up in a few pages
  // starts over from the head (recent trades matter more than an old gap).
  if (st.to >= st.from && head - st.to <= span * FORWARD_PAGES * 2) {
    let cursor = st.to + 1;
    for (let pages = 0, tries = 0; pages < FORWARD_PAGES && cursor <= head && tries < MAX_TRIES && Date.now() < deadline; tries++) {
      const end = Math.min(head, cursor + span - 1);
      const r = await logsInRange(env, filters, cursor, end);
      if ("tooMany" in r) shrink();
      else if ("narrow" in r) span = Math.min(span, 9_999);
      else if ("failed" in r) break;
      else {
        pages++;
        const pts = decodeAll(r.logs, st.pools, priced, decimals);
        st.bars = foldBars(st.bars, pts, "append");
        st.swaps = [...st.swaps, ...pts].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex).slice(-40);
        st.to = end;
        cursor = end + 1;
        widen(r.logs.length);
      }
    }
  } else {
    st = { ...st, from: head + 1, to: head, bars: [], swaps: [], span: Math.min(span, INITIAL_SPAN) };
    span = st.span;
  }

  // Then older blocks, back to the pools' creation, while the request's time budget lasts.
  for (let pages = 0, tries = 0; pages < BACK_PAGES && st.from > st.born && tries < MAX_TRIES && Date.now() < deadline; tries++) {
    const end = st.from - 1;
    const start = Math.max(st.born, end - span + 1);
    const r = await logsInRange(env, filters, start, end);
    if ("tooMany" in r) {
      shrink();
      continue;
    }
    if ("narrow" in r) {
      span = Math.min(span, 9_999);
      continue;
    }
    if ("failed" in r) break;
    pages++;
    const pts = decodeAll(r.logs, st.pools, priced, decimals);
    st.bars = foldBars(st.bars, pts, "prepend");
    if (!st.swaps.length) st.swaps = pts.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex).slice(-40);
    st.from = start;
    widen(r.logs.length);
  }
  if (st.bars.length > MAX_BARS) st.bars = st.bars.slice(-MAX_BARS);
  return { ...st, span };
}

/* ───────── handler ───────── */

async function loadStore(key: string): Promise<Store | null> {
  const hit = await caches.default.match(new Request(key)).catch(() => undefined);
  if (!hit) return null;
  const s = (await hit.json().catch(() => null)) as Store | null;
  return s && s.v === 2 ? s : null;
}

function saveStore(ctx: ExecutionContext, key: string, st: Store): void {
  const res = new Response(JSON.stringify(st), { headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" } });
  ctx.waitUntil(caches.default.put(new Request(key), res).catch(() => undefined));
}

export async function handleMarket(req: Request, env: Env, ctx: ExecutionContext, rawAddress: string): Promise<Response> {
  const token = rawAddress.trim().toLowerCase().replace(/^99901[-:]/, "");
  if (!/^0x[0-9a-f]{40}$/.test(token)) return json({ error: "Invalid contract address." }, 400);
  const url = new URL(req.url);
  const res = (url.searchParams.get("res") ?? "15m") as Res;
  if (!(res in RES)) return json({ error: "res must be 1m, 15m or 1h" }, 400);

  const key = `${url.origin}/__market/v2/${token}?res=${res}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;

  const storeKey = `${url.origin}/__market/v2/store/${token}`;
  try {
    const [headHex, hypeUsd, saved] = await Promise.all([
      (async () => {
        for (const u of healthyUpstreams(env)) {
          const r = await batchOn<string>(u, [{ method: "eth_blockNumber", params: [] }]);
          if (r?.[0]?.result) return r[0].result;
        }
        throw new Error("no upstream answered eth_blockNumber");
      })(),
      hypeUsdOf(req, env, ctx),
      loadStore(storeKey),
    ]);
    const head = parseInt(headHex, 16) - 1;

    let st: Store | null = saved;
    if (!st || Date.now() - st.poolsAt > POOLS_TTL) {
      const found = await discoverPools(env, token);
      if (found) {
        const samePools = st && st.pools.length === found.pools.length && found.pools.every((p) => st!.pools.some((q) => q.id === p.id));
        st = samePools && st
          ? { ...st, pools: found.pools, born: found.born, poolsAt: Date.now() }
          : { v: 2, pools: found.pools, born: found.born, poolsAt: Date.now(), from: head + 1, to: head, span: INITIAL_SPAN, bars: [], swaps: [] };
      }
    }
    if (!st) return json({ error: "Elysium's RPC did not answer the pool lookup. Try again shortly." }, 502);

    const facts = await readFacts(env, token, st.pools);
    const priced = new Set(facts.pools.filter((p) => p.priced).map((p) => p.id));
    st = await grow(env, st, head, priced, facts.decimals);
    saveStore(ctx, storeKey, st);

    const caps = marketCaps(facts.priceHype, { totalSupply: facts.totalSupply, burned: facts.burned, decimals: facts.decimals }, hypeUsd);
    const since = Date.now() / 1000 - RES_WINDOW[res];
    const dayAgo = Date.now() / 1000 - 86_400;
    const covers24h = st.from <= st.born || (st.bars.length > 0 && st.bars[0][0] <= dayAgo);
    const body: MarketResponse = {
      address: token,
      decimals: facts.decimals,
      priceHype: facts.priceHype,
      priceUsd: caps.priceUsd,
      hypeUsd,
      totalSupply: caps.totalSupply,
      burned: caps.burned,
      circulating: caps.circulating,
      mcapHype: caps.mcapHype,
      mcapUsd: caps.mcapUsd,
      fdvHype: caps.fdvHype,
      fdvUsd: caps.fdvUsd,
      liquidityHype: facts.pools.reduce((s, p) => s + p.depthHype, 0),
      volume24hHype: covers24h ? st.bars.reduce((s, b) => (b[0] >= dayAgo ? s + b[5] : s), 0) : null,
      pools: facts.pools.sort((a, b) => b.depthHype - a.depthHype),
      res,
      bars: resample(st.bars.filter((b) => b[0] >= since), RES[res]),
      swaps: st.swaps.slice(-25).reverse(),
      coverage: { fromBlock: st.from, toBlock: st.to, complete: st.from <= st.born },
      updatedAt: Date.now(),
    };
    const out = json(body);
    cachePut(env, ctx, key, out);
    return out;
  } catch (e) {
    return json({ error: `Elysium's RPC did not answer (${(e as Error).message.slice(0, 80)}). Try again shortly.` }, 502);
  }
}
