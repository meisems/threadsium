// Whale watch indexer: one SQLite-backed Durable Object that follows Elysium block by block, keeps every buy of at
// least STORE_MIN_HYPE (5 HYPE), checks each buyer's nonce, searches when new wallets were first funded and by whom,
// and raises the four signals: whale buys, fresh-wallet buys, accumulation and funded clusters.
//
// Loop design for Workers Free: an alarm invocation may make at most 50 subrequests, so each alarm runs ticks until its
// subrequest budget (SUBREQUEST_BUDGET, default 40) or about 50 s is used, then sets the next alarm. The Worker's cron
// and every /api/whales request restart the loop if it ever stops. Nothing here signs or sends a transaction: the RPC
// client refuses any non-read method.
import { DurableObject } from "cloudflare:workers";
import { Budget, BudgetExhausted, Rpc } from "./client.ts";
import { loadEnv, type AppEnv } from "./config.ts";
import { Pipeline, type Logger } from "./pipeline.ts";
import { HypePrice } from "./price.ts";
import { RpcWatch } from "./rpcwatch.ts";
import { SqlStore } from "./store.ts";
import { SIGNAL_TYPES, type SignalRecord, type SignalType } from "./types.ts";
import { signalView, tradeView, type HealthView, type SignalView, type TokenView, type TradeView, type WalletView } from "./views.ts";

const LOOP_MS = 50_000;
const RATE_LIMIT = 120; // requests per minute per caller IP that reach the indexer (the edge cache absorbs most)

type Limited = { error: "rate_limited"; retryAfter: number };
interface Recent { type: SignalType; token: string; symbol: string | null; amount: number; at: number }

const log: Logger = (event, fields) => console.log(JSON.stringify({ event, ...fields }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WhaleIndexer extends DurableObject {
  private readonly app: AppEnv;
  private readonly store: SqlStore;
  private readonly rpc: Rpc;
  private readonly price: HypePrice;
  private readonly pipeline: Pipeline;
  private readonly hits = new Map<string, { count: number; start: number }>();
  private readonly recent: Recent[] = [];
  private running = false;
  private lastTickAt: number | null = null;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private failures = 0;
  private caughtUp = false;
  private lastHourlyFlush = Date.now();
  private priceBudget: Budget | null = null;
  private readonly startedAt = Date.now();
  private invocations = 0;
  private subrequests = 0;
  private readonly watch: RpcWatch;
  private checking = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.app = loadEnv(env as Record<string, string | undefined>);
    this.store = new SqlStore(ctx.storage.sql as never, this.app.chain.name, this.app.dailyWriteBudget);
    this.rpc = new Rpc(this.app.chain.rpcHttp, { batchMax: this.app.rpcBatchMax });
    this.price = new HypePrice((input, init) => {
      this.priceBudget?.take();
      return fetch(input, init);
    });
    this.pipeline = new Pipeline(this.app, this.rpc, this.store, this.price, log);
    this.watch = new RpcWatch(this.rpc);
    const since = Date.now() - 86_400_000;
    for (const row of this.store.recentSignals(5000).reverse()) if (row.createdAt >= since) this.remember(row);
  }

  /* ───────── loop ───────── */

  async alarm() {
    await this.loop();
  }

  /** Starts the loop when no alarm is set (the cron and every Whale watch request call this). */
  async ensureRunning(): Promise<{ alarm: number | null; started: boolean }> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm !== null || this.running) return { alarm, started: false };
    await this.ctx.storage.setAlarm(Date.now() + 100);
    this.store.countWrites(1);
    return { alarm: null, started: true };
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    this.invocations++;
    const budget = new Budget(this.app.subrequestBudget);
    this.pipeline.setBudget(budget);
    this.priceBudget = budget;
    const started = Date.now();
    // The watchdog also runs every second while a tick is in flight, so a tick stuck on a hanging node moves on.
    const ticker = setInterval(() => void this.checkRpc(budget).catch(() => {}), 1000);
    try {
      while (Date.now() - started < LOOP_MS && budget.left >= 6) {
        const tickStart = Date.now();
        await this.checkRpc(budget);
        try {
          if (budget.left > 8) await this.price.refresh();
          const result = await this.pipeline.tick({ maxRounds: 1 });
          this.lastTickAt = Date.now();
          this.failures = 0;
          const behind = this.pipeline.head - this.app.thresholds.confirmations - Math.max(result.to, this.store.getCursor() ?? 0);
          this.caughtUp = result.status === "idle" || behind / Math.max(0.05, this.pipeline.blocksPerSecond) < 3;
          for (const row of result.signals) this.remember(row);
          this.watch.observe(this.pipeline.head, this.store.getCursor());
          if (result.status === "processed")
            log("whales_tick", { from: result.from, to: result.to, head: result.head, trades: result.trades.length, signals: result.signals.length, subrequests: budget.used });
        } catch (error) {
          if (error instanceof BudgetExhausted) {
            if (this.rpc.retryAfterSec > 0 || (this.lastTickAt ?? 0) < tickStart) {
              this.failures++;
              this.lastError = "Request budget used up on retries: the nodes are refusing requests (HTTP 429 / rate limit).";
              this.lastErrorAt = Date.now();
            }
            break;
          }
          this.failures++;
          this.lastError = error instanceof Error ? error.message.slice(0, 200) : "unknown error";
          this.lastErrorAt = Date.now();
          const rate = (error as { kind?: string }).kind === "rate";
          log("whales_tick_error", { error: this.lastError, failures: this.failures, rateLimited: rate });
          if (await this.checkRpc(budget)) continue;
          const backoff = Math.min(rate ? 60_000 : 30_000, 1000 * 2 ** Math.min(rate ? 6 : 5, this.failures));
          await sleep(Math.max(backoff, this.rpc.retryAfterSec * 1000));
          if (Date.now() - started + 5000 > LOOP_MS) break;
          continue;
        }
        if (this.caughtUp && budget.left > 10) {
          const extra = await this.pipeline.extraFunding(Math.min(4, budget.left - 10)).catch((error) => {
            if (error instanceof BudgetExhausted) return [] as SignalRecord[];
            throw error;
          });
          for (const row of extra) this.remember(row);
        }
        if (Date.now() - this.lastHourlyFlush > 5 * 60_000) {
          this.lastHourlyFlush = Date.now();
          this.store.addHourly(this.pipeline.takeHourly());
        }
        if (this.caughtUp) await sleep(Math.max(0, this.app.pollMs - (Date.now() - tickStart)));
      }
    } finally {
      clearInterval(ticker);
      this.running = false;
      this.pipeline.setBudget(new Budget(0));
      this.priceBudget = new Budget(0);
      this.store.flushCursor();
      this.subrequests += budget.used;
      // While the nodes keep refusing, wait longer between invocations (15 s per failure, up to 5 min).
      const next = this.failures > 0 ? Math.min(300_000, 15_000 * this.failures) : this.caughtUp ? Math.min(this.app.pollMs, 1000) : 50;
      await this.ctx.storage.setAlarm(Date.now() + next);
      this.store.countWrites(1);
    }
  }

  private async checkRpc(budget: Budget): Promise<boolean> {
    if (this.checking || !this.watch.due() || budget.left < this.rpc.endpoints.length + 6) return false;
    this.checking = true;
    let switched = false;
    try {
      switched = await this.watch.check(this.pipeline.blocksPerSecond);
    } finally {
      this.checking = false;
    }
    const check = this.watch.last;
    if (check) log(switched ? "whales_rpc_switch" : "whales_rpc_check", { reason: check.reason, from: check.from, to: check.to });
    if (switched) this.failures = 0;
    return switched;
  }

  private remember(row: SignalRecord) {
    this.recent.push({ type: row.type, token: row.token, symbol: row.tokenSymbol, amount: row.amountInHype ?? 0, at: row.createdAt });
    const cutoff = Date.now() - 86_400_000;
    while (this.recent.length && this.recent[0].at < cutoff) this.recent.shift();
    if (this.recent.length > 50_000) this.recent.splice(0, this.recent.length - 50_000);
  }

  /* ───────── reads for the Worker (called over Durable Object RPC) ───────── */

  private limited(ip: string): Limited | null {
    const now = Date.now();
    const hit = this.hits.get(ip);
    if (!hit || now - hit.start >= 60_000) this.hits.set(ip, { count: 1, start: now });
    else if (++hit.count > RATE_LIMIT) return { error: "rate_limited", retryAfter: Math.ceil((hit.start + 60_000 - now) / 1000) };
    if (this.hits.size > 20_000) for (const [key, value] of this.hits) if (now - value.start >= 60_000) this.hits.delete(key);
    return null;
  }

  /** Signals and recent buys for Whale watch: the whole chain, or one token. */
  async feed(
    ip: string,
    filter: { type: SignalType | null; token: string | null; limit: number },
  ): Promise<{ signals: SignalView[]; buys: TradeView[]; counts: Record<SignalType, number>; status: ReturnType<WhaleIndexer["status"]> } | Limited> {
    if (!this.running) this.ctx.waitUntil(this.ensureRunning());
    const limited = this.limited(ip);
    if (limited) return limited;
    const signals = this.store.listSignals({ type: filter.type, token: filter.token, limit: filter.limit }).map(signalView);
    const buys = this.store.recentBuys({ token: filter.token, minHype: this.app.thresholds.storeMinHype, limit: filter.limit }).map(tradeView);
    const cutoff = Date.now() - 86_400_000;
    const counts = Object.fromEntries(SIGNAL_TYPES.map((t) => [t, 0])) as Record<SignalType, number>;
    for (const item of this.recent) if (item.at >= cutoff) counts[item.type]++;
    return { signals, buys, counts, status: this.status() };
  }

  async token(ip: string, address: string): Promise<TokenView | Limited | null> {
    const limited = this.limited(ip);
    if (limited) return limited;
    const { row, trades, hourly } = this.store.token(address);
    const signals = this.store.listSignals({ token: address, limit: 50 });
    if (!row && !trades.length && !signals.length) return null;
    const sum = (key: string) => hourly.reduce((total, item) => total + Number(item[key] ?? 0), 0);
    const pending = this.pipeline.peekHourly(address, Math.floor(Date.now() / 1000) - 86_400);
    const buys = sum("buys") + pending.buys;
    const fresh = sum("fresh_buys") + pending.freshBuys;
    const symbol = (row?.symbol as string) ?? null;
    return {
      address,
      symbol,
      name: (row?.name as string) ?? null,
      decimals: row?.decimals === null || row?.decimals === undefined ? null : Number(row.decimals),
      firstSeenAt: row ? Number(row.first_seen_at) * 1000 : null,
      firstSeenBlock: row ? Number(row.first_seen_block) : null,
      launchpad: (row?.launchpad as string) ?? null,
      stats24h: { buys, whaleBuys: sum("whale_buys") + pending.whaleBuys, freshBuys: fresh, freshShare: buys ? fresh / buys : null, volumeHype: sum("volume_hype") + pending.volumeHype },
      trades: trades.map((trade) => tradeView({ ...trade, symbol })),
      signals: signals.map(signalView),
    };
  }

  async wallet(ip: string, address: string): Promise<WalletView | Limited | null> {
    const limited = this.limited(ip);
    if (limited) return limited;
    const { row, trades } = this.store.wallet(address);
    const signals = this.store.listSignals({ wallet: address, limit: 50 });
    const clusterSignals = this.store.clusterSignalsFor(address, 20);
    const live = this.pipeline.wallets.facts(address as `0x${string}`, Math.floor(Date.now() / 1000));
    if (!row && !trades.length && !signals.length && !clusterSignals.length && live.nonce === null) return null;
    const fundedBy = (row?.funded_by as string) ?? live.fundedBy;
    return {
      address,
      firstSeenAt: row?.first_seen_at ? Number(row.first_seen_at) * 1000 : null,
      nonce: live.nonce ?? (row?.nonce_at_first_seen === null || row?.nonce_at_first_seen === undefined ? null : Number(row.nonce_at_first_seen)),
      fundedBy,
      fundedAt: row?.funded_at ? Number(row.funded_at) * 1000 : live.fundedAt ? live.fundedAt * 1000 : null,
      fundingKind: (row?.funding_kind as string) ?? live.fundingKind,
      fresh: live.fresh,
      trades: trades.map(tradeView),
      signals: signals.map(signalView),
      clusterSignals: clusterSignals.map(signalView),
      siblings: fundedBy ? this.store.siblings(fundedBy, address, 30) : [],
    };
  }

  /** Where the indexer stands, for the page's status line. Host names only: never a full node URL. */
  status() {
    const cursor = this.store.getCursor();
    const head = this.pipeline.head || null;
    const lagBlocks = head !== null && cursor !== null ? Math.max(0, head - cursor) : null;
    const bps = Math.max(0.05, this.pipeline.blocksPerSecond);
    const stalled = this.lastTickAt === null || Date.now() - this.lastTickAt > 90_000;
    const mode: HealthView["mode"] =
      this.lastTickAt === null ? "starting" : stalled ? "stalled" : this.caughtUp || (lagBlocks !== null && lagBlocks / bps < 10) ? "live" : "backfill";
    const failing = this.lastErrorAt !== null && (this.lastTickAt === null || this.lastErrorAt > this.lastTickAt);
    return {
      mode,
      head,
      lastProcessed: cursor,
      lagSeconds: lagBlocks === null ? null : Math.round((lagBlocks / bps) * 10) / 10,
      node: this.rpc.endpointHost,
      nodes: this.rpc.endpoints.map((_, i) => this.rpc.hostOf(i)),
      fundingLookups: this.pipeline.wallets.archive === null ? "untested" : this.pipeline.wallets.archive ? "available" : "unavailable",
      fundingQueue: this.pipeline.wallets.pending,
      error: failing ? this.lastError : null,
      thresholds: this.app.thresholds,
    };
  }

  async health(): Promise<HealthView> {
    const cursor = this.store.getCursor();
    const head = this.pipeline.head || null;
    const lagBlocks = head !== null && cursor !== null ? Math.max(0, head - cursor) : null;
    const s = this.status();
    return {
      ok: s.mode !== "stalled" && s.mode !== "starting",
      chain: this.app.chain.name,
      chainId: this.app.chain.chainId,
      head,
      headTime: this.pipeline.headTime ? Math.round(this.pipeline.headTime * 1000) : null,
      lastProcessed: cursor,
      lagBlocks,
      lagSeconds: s.lagSeconds,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      mode: s.mode,
      rpcHost: this.rpc.endpointHost,
      rpcIsProvider: this.app.chain.rpcIsProvider,
      fundingLookups: s.fundingLookups as HealthView["fundingLookups"],
      fundingQueue: s.fundingQueue,
      writes: { day: this.store.usageDay, used: this.store.rowsWritten, budget: this.app.dailyWriteBudget, tradesPaused: !this.store.canWriteTrades(), bySinceStart: Object.fromEntries(this.store.writesBy) },
      sseClients: 0,
      telegram: "off",
      blocksPerSecond: Math.round(this.pipeline.blocksPerSecond * 100) / 100,
      hypeUsd: this.price.current(),
      now: Date.now(),
      loop: { since: this.startedAt, invocations: this.invocations, subrequests: this.subrequests },
      launchpads: this.pipeline.launchpads.stats(),
      rpc: {
        endpoints: this.rpc.endpoints.map((_, index) => this.rpc.hostOf(index)),
        current: this.rpc.hostOf(this.rpc.preferredIndex),
        idleSeconds: Math.round(this.watch.idleFor() / 100) / 10,
        checks: this.watch.checks,
        switches: this.watch.switches,
        lastCheck: this.watch.last,
        failovers: this.rpc.failovers,
        lastFailover: this.rpc.lastFailover,
      },
    };
  }
}
