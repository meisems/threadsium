// GET /api/whales?token=0x…&type=WHALE_BUY — Elywake's whale and fresh-wallet signals inside Threadsium.
//
// Elywake (D:/Downloads/elywake) is a separate read-only indexer: a Durable Object polls every block of Elysium 99901,
// classifies buys (classify.ts), and runs four detectors (detectors.ts) over a SQLite history. Threadsium does not run a
// second always-on indexer (it would double the free-tier writes and alarms for the same data). Instead:
//   1. When ELYWAKE_API points at a running Elywake deployment, its /api/signals is read server-side (no CORS needed)
//      and passed through: all four signal types, with Elywake's full history and funding searches.
//   2. Otherwise, or when it does not answer, the ported classifier and detectors run on demand over a recent block
//      window: one eth_getLogs (pool Swap events for the whole chain, Transfer events for one token), the transactions
//      and receipts in a few JSON-RPC batches, and a nonce read per sizeable buyer.
//      WHALE_BUY, FRESH_BUY (nonce rule) and ACCUMULATION inside the window are found; CLUSTER needs Elywake's funding
//      search and history, so this mode reports it as unavailable.
// Answers are cached at the edge (and in KV when bound) for 20 seconds per token/type.
import { erc20Abi, type Hex } from "viem";
import { cacheGet, cachePut } from "../kvcache.ts";
import type { Env } from "../env.ts";
import { multicall, publicEnv, upstreams } from "../rpc.ts";
import { handlePrice } from "../tokens.ts";
import { classifyTx, groupByTx, mayBeTrade, TRANSFER_TOPIC, type ClassifierContext } from "./classify.ts";
import { Detectors } from "./detectors.ts";
import { BASES, BRIDGES, HOOKS, ROUTERS, THRESHOLDS, VENUES } from "./labels.ts";
import { SIGNAL_TYPES, type Address, type RawLog, type RawTx, type SignalRecord, type SignalType, type Trade } from "./types.ts";

export interface SignalView {
  id: number;
  type: SignalType;
  token: string;
  symbol: string | null;
  wallet: string | null;
  clusterWallets: string[] | null;
  fundedBy: string | null;
  amountHype: number | null;
  amountUsd: number | null;
  launchpad: string;
  txHash: string;
  blockNumber: number;
  time: number;
  walletNonce: number | null;
  walletFundedAt: number | null;
  buyCount: number | null;
}

export interface WhalesResponse {
  source: "elywake" | "scan";
  sourceNote: string;
  signals: SignalView[];
  window: { fromBlock: number; toBlock: number; fromTime: number | null; toTime: number | null } | null;
  scanned: { buys: number; sells: number; txs: number; truncated: boolean } | null;
  thresholds: { whaleMinHype: number; freshMinHype: number; freshMaxNonce: number; accumMinBuys: number; accumWindowMin: number };
  unavailable: SignalType[];
  hypeUsd: number | null;
  updatedAt: number;
}

const GLOBAL_WINDOW = 4_000; // ~5 minutes at ~14 blocks/s; halved while a node refuses the log count
const TOKEN_WINDOW = 40_000; // ~48 minutes of one token
const GLOBAL_CANDIDATES = 200; // largest HYPE-in swaps whose transactions are read per global scan
const GLOBAL_RECEIPTS = 60; // of those, natively paid ones classified (Workers allow 50 subrequests a request)
const MAX_TXS = 80;
const BATCH = 20;
const CALL_TIMEOUT = 8_000; // healthy Elysium nodes answer a batch or a 4,000-block getLogs in 1-2 s
const SCAN_BUDGET = 20_000; // past this, optional steps (nonces, symbols) are skipped so a slow node cannot 502 the feed
const BENCH_MS = 60_000; // a node that timed out or errored is asked last for this long

const json = (body: unknown, status = 200, maxAge = 20) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": status === 200 ? `public, max-age=${maxAge}` : "no-store" },
  });

/* ───────── JSON-RPC batches ───────── */

let rid = 1;

/**
 * Upstreams that recently timed out or failed, with the time they may lead again. Kept per isolate, so one node that
 * hangs (rpc.elyscan.live took 17-25 s for a getLogs on 11 November 2026) costs one timeout, not one per batch.
 */
const benched = new Map<string, number>();
const bench = (url: string) => benched.set(url, Date.now() + BENCH_MS);
/** Upstreams in configured order, benched ones last. */
export function healthyUpstreams(env: Env, now = Date.now()): string[] {
  const all = upstreams(env);
  const ok = all.filter((u) => (benched.get(u) ?? 0) <= now);
  return [...ok, ...all.filter((u) => !ok.includes(u))];
}

/**
 * Sends calls in JSON-RPC batches of 20 (Boxa's limit). Items a node answers with an error (Kinetiq rate-limits batch
 * items) are retried on the next upstream; a slot stays null only when every upstream failed it.
 */
async function batch<T>(env: Env, calls: { method: string; params: unknown[] }[], size = BATCH): Promise<(T | null)[]> {
  const out: (T | null)[] = new Array(calls.length).fill(null);
  // Whale watch scans read the public nodes only; the launchpads' nodes serve swaps, charts and everything else.
  let order = healthyUpstreams(publicEnv(env));
  for (let i = 0; i < calls.length; i += size) {
    let pending = calls.slice(i, i + size).map((c, k) => ({ at: i + k, req: { jsonrpc: "2.0", id: rid++, method: c.method, params: c.params } }));
    for (const url of [...order]) {
      if (!pending.length) break;
      const asked = pending.length;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pending.map((p) => p.req)),
          signal: AbortSignal.timeout(CALL_TIMEOUT),
        });
        const arr = res.ok ? ((await res.json()) as { id: number; result?: T; error?: unknown }[]) : null;
        if (!Array.isArray(arr)) {
          bench(url);
          order = [...order.filter((u) => u !== url), url];
          continue;
        }
        const byId = new Map(arr.map((r) => [r.id, r]));
        pending = pending.filter((p) => {
          const r = byId.get(p.req.id);
          if (!r || r.error !== undefined) return true;
          out[p.at] = (r.result ?? null) as T | null;
          return false;
        });
        // A node that refused most of the batch (rate limit) goes to the back for the rest of this scan.
        if (pending.length * 2 > asked) order = [...order.filter((u) => u !== url), url];
      } catch {
        // Timeout or network error: next upstream, and this one goes to the back for the rest of the scan and the next minute.
        bench(url);
        order = [...order.filter((u) => u !== url), url];
      }
    }
  }
  return out;
}

/** One JSON-RPC call; a JSON-RPC error moves on to the next upstream, and the last error message is thrown. */
async function one<T>(env: Env, method: string, params: unknown[]): Promise<T> {
  let last = "no upstream answered";
  for (const url of healthyUpstreams(publicEnv(env))) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method, params }),
        signal: AbortSignal.timeout(CALL_TIMEOUT),
      });
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        bench(url);
        continue;
      }
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) {
        last = String(j.error.message ?? "RPC error");
        continue;
      }
      return j.result as T;
    } catch (e) {
      last = (e as Error).message;
      bench(url);
    }
  }
  throw new Error(last);
}

const TOO_MANY = /limit|exceed|too many|too large|range|narrow/i;

/**
 * eth_getLogs over the newest `span` blocks, halving the span whenever a node refuses the size (Kinetiq caps an answer
 * at 10,000 logs; Elysium makes ~14 blocks a second and the busiest minutes produce thousands of logs).
 */
async function recentLogs(env: Env, head: number, span: number, filter: Record<string, unknown>): Promise<{ logs: LogWithTime[]; from: number }> {
  for (let s = span; ; s = Math.floor(s / 2)) {
    const from = Math.max(0, head - s);
    try {
      const logs = await one<LogWithTime[]>(env, "eth_getLogs", [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }]);
      return { logs, from };
    } catch (e) {
      if (s <= 200 || !TOO_MANY.test((e as Error).message)) throw e;
    }
  }
}

/* ───────── on-demand scan with the ported classifier + detectors ───────── */

type LogWithTime = RawLog & { blockTimestamp?: Hex };

const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const V4_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const NATIVE_TOPIC = `0x${"0".repeat(64)}`;
const signed = (hex: string) => {
  const v = BigInt(`0x${hex}`);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
};

/** V4 pool id → its hook when the pool pairs native HYPE (currency0 = 0x0), or null when it does not. Kept per isolate. */
const nativePools = new Map<string, string | null>();

/** Looks up unknown pool ids in their managers' Initialize events (topic-filtered, so one small query per 100 ids). */
async function resolveNativePools(env: Env, managers: string[], ids: string[]): Promise<void> {
  const unknown = [...new Set(ids)].filter((id) => !nativePools.has(id)).slice(0, 300);
  for (let i = 0; i < unknown.length; i += 100) {
    const chunk = unknown.slice(i, i + 100);
    const logs = await one<LogWithTime[]>(env, "eth_getLogs", [
      { address: managers, topics: [V4_INITIALIZE, chunk, NATIVE_TOPIC], fromBlock: "0x0", toBlock: "latest" },
    ]).catch(() => null);
    if (!logs) return; // unknown stays unknown; the next request tries again
    const found = new Map<string, string>();
    for (const l of logs) {
      const d = l.data.slice(2);
      found.set(l.topics[1].toLowerCase(), d.length >= 192 ? `0x${d.slice(152, 192)}`.toLowerCase() : "");
    }
    for (const id of chunk) nativePools.set(id, found.get(id) ?? null);
  }
  if (nativePools.size > 50_000) nativePools.clear();
}

/**
 * Global feed candidates. Every ERC-20 Transfer on the chain is far too much to read per request (a minute of Elysium is
 * thousands of logs and about 1,000 V4 swaps), so V4 Swap events pick the transactions worth classifying: swaps in
 * native-HYPE pools where HYPE went in (V4 deltas are the swapper's, so a negative amount0 is HYPE paid: a buy), ranked
 * by size. The biggest go to Elywake's classifier, which decides from the full receipt what each one actually was.
 * V3 pools (a few percent of Elysium's buys) are left to the token-room scan and to the full Elywake indexer.
 */
async function swapCandidates(env: Env, logs: LogWithTime[], minWei: bigint): Promise<{ hashes: Hex[]; hooks: Map<Hex, string> }> {
  const buys = logs
    .filter((l) => l.topics[0] === V4_SWAP && l.data.length >= 130)
    .map((l) => ({ l, a0: signed(l.data.slice(2, 66)) }))
    .filter((x) => x.a0 < 0n && -x.a0 >= minWei);
  await resolveNativePools(
    env,
    [...new Set(buys.map((x) => x.l.address.toLowerCase()))],
    buys.map((x) => x.l.topics[1].toLowerCase()),
  );
  const size = new Map<Hex, bigint>();
  const hooks = new Map<Hex, string>();
  for (const { l, a0 } of buys) {
    const hook = nativePools.get(l.topics[1].toLowerCase());
    if (hook === null || hook === undefined) continue;
    const h = l.transactionHash.toLowerCase() as Hex;
    if ((size.get(h) ?? 0n) < -a0) size.set(h, -a0);
    if (hook) hooks.set(h, hook);
  }
  const hashes = [...size.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, GLOBAL_CANDIDATES)
    .map(([h]) => h);
  return { hashes, hooks };
}

export async function scan(
  env: Env,
  token: string | null,
  hypeUsd: number | null,
): Promise<Omit<WhalesResponse, "source" | "sourceNote" | "hypeUsd" | "updatedAt"> & { skippedFreshness: boolean }> {
  const overBudget = ((start) => () => Date.now() - start > SCAN_BUDGET)(Date.now());
  const head = parseInt(await one<string>(env, "eth_blockNumber", []), 16) - THRESHOLDS.confirmations;

  // 1. Which transactions to classify.
  let hashes: Hex[];
  let from: number;
  let truncated = false;
  let hookOf = new Map<Hex, string>();
  if (!token) {
    const r = await recentLogs(env, head, GLOBAL_WINDOW, { topics: [V4_SWAP] });
    from = r.from;
    const c = await swapCandidates(env, r.logs, BigInt(THRESHOLDS.freshMinHype) * 10n ** 18n);
    hashes = c.hashes;
    hookOf = c.hooks;
    truncated = hashes.length >= GLOBAL_CANDIDATES;
  } else {
    const r = await recentLogs(env, head, TOKEN_WINDOW, { address: token, topics: [TRANSFER_TOPIC] });
    from = r.from;
    hashes = [...new Set(r.logs.map((l) => l.transactionHash.toLowerCase() as Hex))];
    if (hashes.length > MAX_TXS) {
      truncated = true;
      hashes = hashes.slice(-MAX_TXS); // logs come in block order: keep the newest
    }
  }

  // 2. The transactions, then the full receipts (the classifier needs every leg of a trade). In the global scan a HYPE
  //    pool buy that sent no HYPE with the transaction was paid from a contract's balance, which Elywake's classifier
  //    cannot see (its documented blind spot), so only natively paid candidates have their receipts read.
  let txs = await batch<RawTx>(env, hashes.map((h) => ({ method: "eth_getTransactionByHash", params: [h] })));
  if (!token) {
    const keep = txs.map((t, i) => (t && BigInt(t.value || "0x0") > 0n ? i : -1)).filter((i) => i >= 0).slice(0, GLOBAL_RECEIPTS);
    hashes = keep.map((i) => hashes[i]);
    txs = keep.map((i) => txs[i]);
  }
  const receipts = await batch<{ logs: LogWithTime[] }>(env, hashes.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] })));
  const logs: LogWithTime[] = [];
  for (const r of receipts) if (r?.logs) logs.push(...r.logs);
  const byTx = groupByTx(logs);

  // 3. Block times: Nitro puts blockTimestamp on logs; blocks without one are interpolated between the window's ends.
  const times = new Map<number, number>();
  for (const l of logs) if (l.blockTimestamp) times.set(parseInt(l.blockNumber, 16), parseInt(l.blockTimestamp, 16));
  const [a, b] = await batch<{ timestamp: Hex }>(env, [
    { method: "eth_getBlockByNumber", params: [`0x${from.toString(16)}`, false] },
    { method: "eth_getBlockByNumber", params: [`0x${head.toString(16)}`, false] },
  ]);
  const ends: [number, number] | null = a && b ? [parseInt(a.timestamp, 16), parseInt(b.timestamp, 16)] : null;
  const timeOf = (block: number) =>
    times.get(block) ?? (ends ? Math.round(ends[0] + ((ends[1] - ends[0]) * (block - from)) / Math.max(1, head - from)) : Math.floor(Date.now() / 1000));

  // 4. Classify with Elywake's rule (net flows of tx.from).
  const ctx: ClassifierContext = { bases: BASES, bridges: BRIDGES, launchpads: ROUTERS, hypeUsd };
  const trades: Trade[] = [];
  txs.forEach((tx, i) => {
    if (!tx || !tx.blockNumber) return;
    const list = byTx.get(hashes[i]);
    if (!list || !mayBeTrade(list, { bases: BASES })) return;
    for (const t of classifyTx(tx, list, timeOf(parseInt(tx.blockNumber, 16)), ctx)) {
      if (token && t.token !== token) continue;
      if (t.launchpad === "unknown") t.launchpad = HOOKS.get((hookOf.get(t.txHash) ?? "") as Address) ?? (t.venue ? VENUES.get(t.venue) : undefined) ?? "unknown";
      trades.push(t);
    }
  });
  trades.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const buys = trades.filter((t) => t.side === "BUY");

  // 5. Freshness: nonce at the buy's block for buys big enough to matter (Elywake's FRESH rule). Skipped when the scan
  //    is already over budget (a slow node), so whale buys still come back instead of the whole request timing out.
  const skippedFreshness = overBudget();
  const sized = skippedFreshness ? [] : buys.filter((t) => (t.amountInHype ?? 0) >= THRESHOLDS.freshMinHype);
  const wallets = [...new Map(sized.map((t) => [`${t.wallet}:${t.blockNumber}`, t])).values()].slice(-80);
  const nonces = await batch<Hex>(env, wallets.map((t) => ({ method: "eth_getTransactionCount", params: [t.wallet, `0x${t.blockNumber.toString(16)}`] })));
  const nonceOf = new Map<string, number>();
  wallets.forEach((t, i) => {
    if (nonces[i]) nonceOf.set(`${t.wallet}:${t.blockNumber}`, parseInt(nonces[i] as string, 16));
  });

  // 6. Detectors, in block order.
  const detectors = new Detectors(THRESHOLDS);
  const found: SignalRecord[] = [];
  for (const trade of buys) {
    const nonce = nonceOf.get(`${trade.wallet}:${trade.blockNumber}`) ?? null;
    const fresh = nonce === null ? null : nonce <= THRESHOLDS.freshMaxNonce;
    const facts = { nonce, nonceAtBlock: nonce !== null, fundedBy: null, fundedAt: null, fundingKind: "unavailable" as const, fresh };
    found.push(...detectors.onBuy({ trade, facts, tokenSymbol: null, hypeUsd }));
  }

  // 7. Symbols for the tokens that fired.
  const tokens = [...new Set(found.map((s) => s.token))].slice(0, 80);
  const symbols = new Map<string, string>();
  if (tokens.length && !overBudget()) {
    const res = await multicall<string>(env, tokens.map((t) => ({ target: t, abi: erc20Abi, functionName: "symbol" }))).catch(() => []);
    tokens.forEach((t, i) => {
      const s = res[i];
      if (typeof s === "string" && s.trim()) symbols.set(t, s.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 16));
    });
  }

  const signals: SignalView[] = found
    .slice()
    .reverse()
    .slice(0, 60)
    .map((s, i) => ({
      id: i + 1,
      type: s.type,
      token: s.token,
      symbol: symbols.get(s.token) ?? null,
      wallet: s.wallet,
      clusterWallets: s.clusterWallets,
      fundedBy: s.fundedBy,
      amountHype: s.amountInHype,
      amountUsd: s.amountInHype !== null && hypeUsd ? s.amountInHype * hypeUsd : null,
      launchpad: s.launchpad,
      txHash: s.txHash,
      blockNumber: s.blockNumber,
      time: s.createdAt,
      walletNonce: s.walletNonce,
      walletFundedAt: s.walletFundedAt,
      buyCount: s.buyCount ?? null,
    }));

  return {
    signals,
    window: { fromBlock: from, toBlock: head, fromTime: timeOf(from) * 1000, toTime: timeOf(head) * 1000 },
    scanned: { buys: buys.length, sells: trades.length - buys.length, txs: hashes.length, truncated },
    thresholds: THRESHOLDS,
    unavailable: ["CLUSTER"],
    skippedFreshness,
  };
}

/* ───────── Elywake pass-through ───────── */

async function fromElywake(base: string, token: string | null, type: SignalType | null): Promise<SignalView[] | null> {
  const q = new URLSearchParams({ limit: "50" });
  if (token) q.set("token", token);
  if (type) q.set("type", type);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/signals?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { signals?: SignalView[] };
    return Array.isArray(body.signals) ? body.signals.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export async function hypeUsdOf(req: Request, env: Env, ctx: ExecutionContext): Promise<number | null> {
  try {
    const res = await handlePrice(new Request(new URL("/api/price", req.url)), env, ctx);
    const body = (await res.json()) as { hypeUsd?: number | null };
    return body.hypeUsd && body.hypeUsd > 0 ? body.hypeUsd : null;
  } catch {
    return null;
  }
}

export async function handleWhales(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const rawToken = url.searchParams.get("token");
  if (rawToken && !/^0x[0-9a-fA-F]{40}$/.test(rawToken)) return json({ error: "token must be a 0x address" }, 400);
  const rawType = url.searchParams.get("type")?.toUpperCase() || null;
  if (rawType && !SIGNAL_TYPES.includes(rawType as SignalType)) return json({ error: `type must be one of ${SIGNAL_TYPES.join(", ")}` }, 400);
  const token = rawToken ? (rawToken.toLowerCase() as Address) : null;
  const type = rawType as SignalType | null;

  const key = `${url.origin}/__whales/v1?token=${token ?? ""}&type=${type ?? ""}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;

  const hypeUsd = await hypeUsdOf(req, env, ctx);
  const base = (env.ELYWAKE_API || "").trim();
  let body: WhalesResponse | null = null;

  if (/^https:\/\//.test(base)) {
    const signals = await fromElywake(base, token, type);
    if (signals) {
      body = {
        source: "elywake",
        sourceNote: `Live from the Elywake indexer (${new URL(base).host}): every block of Elysium 99901, with funding searches for fresh wallets and clusters.`,
        signals,
        window: null,
        scanned: null,
        thresholds: THRESHOLDS,
        unavailable: [],
        hypeUsd,
        updatedAt: Date.now(),
      };
    }
  }

  if (!body) {
    try {
      const { skippedFreshness, ...r } = await scan(env, token, hypeUsd);
      body = {
        source: "scan",
        sourceNote:
          (token
            ? "Scanned on demand from the last ~45 minutes of this token's transfers with Elywake's classifier and detectors."
            : "Scanned on demand with Elywake's classifier and detectors: the largest HYPE-paid buys in native-HYPE V4 pools over the last few minutes of Elysium blocks.") +
          (skippedFreshness ? " Elysium's RPC was slow, so wallet freshness was not checked this time." : ""),
        ...r,
        signals: type ? r.signals.filter((s) => s.type === type) : r.signals,
        hypeUsd,
        updatedAt: Date.now(),
      };
    } catch (e) {
      return json({ error: `Elysium's RPC did not answer the scan (${(e as Error).message.slice(0, 80)}). Try again shortly.` }, 502);
    }
  }

  const res = json(body, 200, 20);
  cachePut(env, ctx, key, res, 60);
  return res;
}

