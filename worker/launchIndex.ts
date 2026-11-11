// On-chain launch index for every launchpad in src/config/launchpads.ts (chain 99901).
//
// Each launchpad lists its launch sources: a V4 PoolManager `Initialize` whose PoolKey uses the launchpad's hook,
// or a `PoolCreated` from a V3 factory the launchpad owns. This module scans those logs forward from a saved
// cursor per emitter, attributes every new pool's launched token to its launchpad, and stores it in the
// `launches` table (migrations/0003_launch_index.sql). Nothing here depends on a third-party indexer.
//
// A cursor key includes the emitter's hook set, so adding a launch source to the registry starts a fresh scan
// of that emitter from the source's startBlock; rows already stored are kept (INSERT OR IGNORE).
import { parseAbi } from "viem";
import {
  LAUNCHPAD_REGISTRY,
  LAUNCH_EVENTS,
  type LaunchEventKind,
  type LaunchpadEntry,
} from "../src/config/launchpads.ts";
import { WHYPE_SET } from "../src/config/venues.ts";
import type { Env, SqlDb } from "./env.ts";
import { call, multicall } from "./rpc.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Bridged assets and ecosystem tokens that trade in launchpad pools but were not launched there. */
export const NOT_LAUNCHED = new Set<string>([
  ...WHYPE_SET,
  ZERO,
  "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0", // KNTQ
  "0x248888d396a546a69a188f3deb476964e581e9d0",
  "0xb47c4c8f73f009cc0c0d3f92b388d13e293f0b65",
  "0x437c847644ff22cbcf0ea56896aa25504aad93b4",
  "0x9039ebd84ee2a0e198eb265e692390762995872c",
  "0xd4012d8b8095345cf3a83a7c118bbcf58f617079",
  "0x455dd9857dfc2cd599da185be0203ba8bb456603",
  "0x11265018bf2d5a99fb71efae73ad670203c1df44",
]);

/** HYPE and its wrappers: the quote side of almost every launch pool. */
const HYPE_QUOTES = new Set<string>([ZERO, ...WHYPE_SET]);

/** Secondary quotes: bridged assets plus launchpad platform tokens (e.g. Kleos pairs launches against KLEOS). */
const OTHER_QUOTES = new Set<string>([
  ...NOT_LAUNCHED,
  ...LAUNCHPAD_REGISTRY.flatMap((lp) => (lp.token ? [lp.token.address.toLowerCase()] : [])),
]);

/** Pick the launched token out of a pool's two currencies, or null when neither side is clearly the launch. */
export function launchedTokenOf(c0: string, c1: string): string | null {
  const a = c0.toLowerCase();
  const b = c1.toLowerCase();
  const pick = (quotes: Set<string>): string | null | undefined => {
    const qa = quotes.has(a);
    const qb = quotes.has(b);
    if (qa && !qb) return b;
    if (qb && !qa) return a;
    if (qa && qb) return null;
    return undefined;
  };
  const viaHype = pick(HYPE_QUOTES);
  const token = viaHype === undefined ? pick(OTHER_QUOTES) : viaHype;
  if (!token || NOT_LAUNCHED.has(token)) return null;
  return token;
}

export interface EmitterPlan {
  key: string;
  event: LaunchEventKind;
  emitter: string;
  startBlock: number;
  /** v4-initialize: hook -> launchpad id. */
  hooks: Map<string, string>;
  /** v3-pool-created: the launchpad that owns the factory. */
  launchpadId: string | null;
}

/** Group every launch source in the registry by the contract that emits it, so each emitter is scanned once. */
export function buildEmitterPlans(registry: LaunchpadEntry[] = LAUNCHPAD_REGISTRY): EmitterPlan[] {
  const plans = new Map<string, EmitterPlan>();
  for (const lp of registry) {
    for (const s of lp.launchSources) {
      const emitter = s.emitter.toLowerCase();
      const id = `${s.event}:${emitter}`;
      let plan = plans.get(id);
      if (!plan) {
        plan = { key: id, event: s.event, emitter, startBlock: s.startBlock, hooks: new Map(), launchpadId: null };
        plans.set(id, plan);
      }
      plan.startBlock = Math.min(plan.startBlock, s.startBlock);
      if (s.event === "v4-initialize" && s.hook) {
        const hook = s.hook.toLowerCase();
        if (!plan.hooks.has(hook)) plan.hooks.set(hook, lp.id);
      } else if (s.event === "v3-pool-created") {
        plan.launchpadId ??= lp.id;
      }
    }
  }
  for (const plan of plans.values()) {
    if (plan.event === "v4-initialize") plan.key = `${plan.key}:${[...plan.hooks.keys()].sort().join(",")}`;
  }
  return [...plans.values()];
}

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
}

export interface LaunchRow {
  launchpadId: string;
  token: string;
  pool: string;
  emitter: string;
  block: number;
  createdAt: number | null;
  symbol?: string | null;
  name?: string | null;
}

const topicAddr = (t: string | undefined): string => `0x${(t ?? "").slice(26)}`.toLowerCase();
const dataWord = (data: string, i: number): string => {
  const d = data.startsWith("0x") ? data.slice(2) : data;
  return d.slice(i * 64, i * 64 + 64);
};

/** Turn one Initialize / PoolCreated log into a launch, or null if it is not one of the plan's launchpads. */
export function decodeLaunchLog(plan: EmitterPlan, log: RawLog): Omit<LaunchRow, "createdAt"> | null {
  if (!Array.isArray(log.topics) || log.topics[0]?.toLowerCase() !== LAUNCH_EVENTS[plan.event].topic0) return null;
  const block = parseInt(log.blockNumber, 16);
  if (plan.event === "v4-initialize") {
    // Initialize(id indexed, currency0 indexed, currency1 indexed, fee, tickSpacing, hooks, sqrtPriceX96, tick)
    if (log.topics.length < 4) return null;
    const hook = `0x${dataWord(log.data, 2).slice(24)}`.toLowerCase();
    const launchpadId = plan.hooks.get(hook);
    if (!launchpadId) return null;
    const token = launchedTokenOf(topicAddr(log.topics[2]), topicAddr(log.topics[3]));
    if (!token) return null;
    return { launchpadId, token, pool: `${plan.emitter}:${log.topics[1].toLowerCase()}`, emitter: plan.emitter, block };
  }
  // PoolCreated(token0 indexed, token1 indexed, fee indexed, tickSpacing, pool)
  if (!plan.launchpadId || log.topics.length < 3) return null;
  const token = launchedTokenOf(topicAddr(log.topics[1]), topicAddr(log.topics[2]));
  if (!token) return null;
  return {
    launchpadId: plan.launchpadId,
    token,
    pool: `0x${dataWord(log.data, 1).slice(24)}`.toLowerCase(),
    emitter: plan.emitter,
    block,
  };
}

// ---- sync ----------------------------------------------------------------------------------------------

const MIN_SPAN = 9_000; // public fallback RPCs cap eth_getLogs at 10k blocks
const MAX_SPAN = 4_000_000;
const TARGET_LOGS = 3_000;
const INSERT_CHUNK = 400;
const META_PER_LAUNCHPAD = 12;

const spans = new Map<string, number>();
const blockTimes = new Map<number, number>();
let inflight: Promise<LaunchSyncReport> | null = null;
let lastReport: LaunchSyncReport | null = null;
let lastRunAt = 0;

export interface LaunchSyncReport {
  latestBlock: number;
  inserted: number;
  lagBlocks: number;
  emitters: { key: string; nextBlock: number }[];
}

async function blockTime(env: Env, n: number): Promise<number | null> {
  const hit = blockTimes.get(n);
  if (hit) return hit;
  try {
    const b = await call<{ timestamp?: string } | null>(env, "eth_getBlockByNumber", [`0x${n.toString(16)}`, false]);
    const ts = b?.timestamp ? parseInt(b.timestamp, 16) : NaN;
    if (!Number.isFinite(ts)) return null;
    if (blockTimes.size > 512) blockTimes.clear();
    blockTimes.set(n, ts);
    return ts;
  } catch {
    return null;
  }
}

async function readCursors(db: SqlDb): Promise<Map<string, number>> {
  const rows = await db
    .prepare("SELECT key, next_block FROM launch_index_cursors")
    .all<{ key: string; next_block: number }>()
    .then((r) => r.results)
    .catch(() => []);
  return new Map(rows.map((r) => [r.key, Number(r.next_block)]));
}

/** Scan one block window for one emitter and store its launches. Returns log and launch counts, or null on RPC failure. */
async function scanWindow(
  env: Env,
  db: SqlDb,
  plan: EmitterPlan,
  from: number,
  to: number,
): Promise<{ logs: number; launches: number } | null> {
  let logs: RawLog[];
  try {
    logs = await call<RawLog[]>(env, "eth_getLogs", [
      {
        address: plan.emitter,
        topics: [LAUNCH_EVENTS[plan.event].topic0],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      },
    ]);
  } catch {
    return null;
  }
  const decoded = (Array.isArray(logs) ? logs : [])
    .map((l) => decodeLaunchLog(plan, l))
    .filter((r): r is Omit<LaunchRow, "createdAt"> => r !== null);

  // Block timestamps are interpolated between the window's ends: two RPC calls instead of one per launch.
  let tsAt: (b: number) => number | null = () => null;
  if (decoded.length) {
    const [t0, t1] = await Promise.all([blockTime(env, from), blockTime(env, to)]);
    if (t0 && t1) tsAt = (b) => Math.round(t0 + ((b - from) * (t1 - t0)) / Math.max(1, to - from));
  }

  const now = Date.now();
  const stmts = decoded.map((r) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO launches (launchpad_id, token, pool, emitter, block, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(r.launchpadId, r.token, r.pool, r.emitter, r.block, tsAt(r.block)),
  );
  const cursor = db
    .prepare(
      `INSERT INTO launch_index_cursors (key, next_block, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET next_block = MAX(next_block, excluded.next_block), updated_at = excluded.updated_at`,
    )
    .bind(plan.key, to + 1, now);
  for (let i = 0; i < stmts.length; i += INSERT_CHUNK) {
    const chunk = stmts.slice(i, i + INSERT_CHUNK);
    await db.batch(i + INSERT_CHUNK >= stmts.length ? [...chunk, cursor] : chunk);
  }
  if (!stmts.length) await db.batch([cursor]);
  return { logs: Array.isArray(logs) ? logs.length : 0, launches: decoded.length };
}

async function fillTokenMeta(env: Env, db: SqlDb): Promise<void> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT token FROM (
         SELECT token, symbol, ROW_NUMBER() OVER (PARTITION BY launchpad_id ORDER BY block DESC) AS rn FROM launches
       ) WHERE rn <= ? AND symbol IS NULL LIMIT 300`,
    )
    .bind(META_PER_LAUNCHPAD)
    .all<{ token: string }>()
    .then((r) => r.results)
    .catch(() => []);
  if (!rows.length) return;
  const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
  let out: (string | null)[];
  try {
    out = await multicall<string>(
      env,
      rows.flatMap((r) => [
        { target: r.token, abi: ERC20, functionName: "symbol" },
        { target: r.token, abi: ERC20, functionName: "name" },
      ]),
    );
  } catch {
    return;
  }
  const clean = (s: string | null, max: number) =>
    String(s ?? "")
      .replace(/[\u0000-\u001f\u007f<>]/g, "")
      .trim()
      .slice(0, max);
  await db.batch(
    rows.map((r, i) =>
      db
        .prepare("UPDATE launches SET symbol = ?, name = ? WHERE token = ?")
        .bind(clean(out[i * 2], 20), clean(out[i * 2 + 1], 42), r.token),
    ),
  );
}

async function runSync(env: Env, db: SqlDb, budgetMs: number): Promise<LaunchSyncReport> {
  const deadline = Date.now() + budgetMs;
  const latest = parseInt(await call<string>(env, "eth_blockNumber", []), 16);
  const plans = buildEmitterPlans();
  const cursors = await readCursors(db);
  const next = new Map(plans.map((p) => [p.key, cursors.get(p.key) ?? p.startBlock]));
  const stuck = new Set<string>();
  let inserted = 0;

  // Round-robin one window per emitter so a busy PoolManager never starves the small factories.
  for (let progressed = true; progressed && Date.now() < deadline; ) {
    progressed = false;
    for (const plan of plans) {
      if (Date.now() >= deadline) break;
      const from = next.get(plan.key)!;
      if (from > latest || stuck.has(plan.key)) continue;
      const span = spans.get(plan.key) ?? 500_000;
      const to = Math.min(latest, from + span - 1);
      const found = await scanWindow(env, db, plan, from, to);
      if (found === null) {
        // Too many logs for one response, or the range is refused: narrow the window and retry next round.
        if (span <= MIN_SPAN) stuck.add(plan.key);
        spans.set(plan.key, Math.max(MIN_SPAN, Math.floor(span / 4)));
        progressed = true;
        continue;
      }
      inserted += found.launches;
      next.set(plan.key, to + 1);
      spans.set(
        plan.key,
        found.logs > TARGET_LOGS
          ? Math.max(MIN_SPAN, Math.floor(span / 2))
          : found.logs < TARGET_LOGS / 4
            ? Math.min(MAX_SPAN, span * 2)
            : span,
      );
      progressed = true;
    }
  }

  // Names for the newest launches of each launchpad (the ones the pages show); one or two multicalls.
  await fillTokenMeta(env, db).catch(() => undefined);

  const emitters = plans.map((p) => ({ key: p.key, nextBlock: next.get(p.key)! }));
  return {
    latestBlock: latest,
    inserted,
    lagBlocks: Math.max(0, ...emitters.map((e) => latest + 1 - e.nextBlock)),
    emitters,
  };
}

/**
 * Advance the launch index toward the chain head within `budgetMs`. Concurrent callers in one isolate share a
 * run, and runs closer than 15s apart return the previous report.
 */
export function syncLaunchIndex(env: Env, budgetMs = 12_000): Promise<LaunchSyncReport | null> {
  const db = env.DB;
  if (!db) return Promise.resolve(null);
  if (inflight) return inflight;
  if (lastReport && Date.now() - lastRunAt < 15_000) return Promise.resolve(lastReport);
  inflight = runSync(env, db, budgetMs)
    .then((r) => (lastReport = r))
    .finally(() => {
      inflight = null;
      lastRunAt = Date.now();
    });
  return inflight.catch((e) => {
    console.warn("launch index sync failed:", (e as Error)?.message);
    return null;
  });
}

// ---- reads ---------------------------------------------------------------------------------------------

export interface LaunchIndexSummary {
  rows: number;
  counts: Map<string, { launches: number; launches24h: number }>;
  recent: LaunchRow[];
  lagBlocks: number | null;
}

/** Launch counts per launchpad plus the newest `perLaunchpad` launches of each. */
export async function readLaunchIndex(
  db: SqlDb,
  nowSeconds = Math.floor(Date.now() / 1000),
  perLaunchpad = 12,
): Promise<LaunchIndexSummary> {
  const [countRows, recentRows] = await Promise.all([
    db
      .prepare(
        "SELECT launchpad_id, COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS n24 FROM launches GROUP BY launchpad_id",
      )
      .bind(nowSeconds - 86_400)
      .all<{ launchpad_id: string; n: number; n24: number | null }>()
      .then((r) => r.results),
    db
      .prepare(
        `SELECT launchpad_id, token, pool, emitter, block, created_at, symbol, name FROM (
           SELECT l.*, ROW_NUMBER() OVER (PARTITION BY launchpad_id ORDER BY block DESC) AS rn FROM launches l
         ) WHERE rn <= ?`,
      )
      .bind(perLaunchpad)
      .all<{
        launchpad_id: string;
        token: string;
        pool: string;
        emitter: string;
        block: number;
        created_at: number | null;
        symbol: string | null;
        name: string | null;
      }>()
      .then((r) => r.results),
  ]);
  const counts = new Map<string, { launches: number; launches24h: number }>();
  let rows = 0;
  for (const r of countRows) {
    counts.set(r.launchpad_id, { launches: Number(r.n), launches24h: Number(r.n24 ?? 0) });
    rows += Number(r.n);
  }
  return {
    rows,
    counts,
    recent: recentRows.map((r) => ({
      launchpadId: r.launchpad_id,
      token: r.token,
      pool: r.pool,
      emitter: r.emitter,
      block: Number(r.block),
      createdAt: r.created_at === null ? null : Number(r.created_at),
      symbol: r.symbol,
      name: r.name,
    })),
    lagBlocks: lastReport?.lagBlocks ?? null,
  };
}

/** Origin launchpad (earliest indexed launch) for each of `tokens` that the index knows. */
export async function launchpadsOfTokens(db: SqlDb, tokens: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = [...new Set(tokens.map((t) => t.toLowerCase()))];
  for (let i = 0; i < list.length; i += 400) {
    const rows = await db
      .prepare(
        "SELECT token, launchpad_id, MIN(block) AS b FROM launches WHERE token IN (SELECT value FROM json_each(?)) GROUP BY token",
      )
      .bind(JSON.stringify(list.slice(i, i + 400)))
      .all<{ token: string; launchpad_id: string }>()
      .then((r) => r.results)
      .catch(() => []);
    for (const r of rows) out.set(r.token, r.launchpad_id);
  }
  return out;
}
