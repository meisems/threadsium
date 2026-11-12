// One indexing step: logs for a block range -> transactions -> classified trades -> wallet facts -> detectors ->
// persistence through a Store. Shared by the Durable Object indexer (live) and scripts/replay.ts (fixed ranges), so
// what is tested offline is what runs in production.

import { classifyTx, groupByTx, mayBeTrade, TRANSFER_TOPIC, WITHDRAWAL_TOPIC, type ClassifierContext } from "./classify.ts";
import { Detectors, type BuyEvent } from "./detectors.ts";
import type { AppEnv } from "./config.ts";
import type { HypePrice } from "./price.ts";
import { LaunchpadResolver } from "./launchpads.ts";
import { Rpc, hexToNumber, toHex, type Budget } from "./client.ts";
import { fetchTokenMeta } from "./tokens.ts";
import type { Address, Hex, RawLog, RawTx, SignalRecord, TokenMeta, Trade, WalletFacts } from "./types.ts";
import { WalletBook } from "./wallets.ts";

export interface StoredTrade extends Trade { walletNonce: number | null; fresh: boolean | null }
export interface WalletRow { address: Address; firstSeenAt: number; nonce: number | null; fundedBy: Address | null; fundedAt: number | null; fundingKind: string }
export interface TokenRow extends TokenMeta { firstSeenBlock: number; firstSeenAt: number; launchpad: string }
export interface HourlyRow { token: Address; hour: number; buys: number; freshBuys: number; whaleBuys: number; volumeHype: number }

export interface Store {
  getCursor(): number | null;
  setCursor(block: number): void;
  knownToken(address: Address): TokenMeta | null;
  /** The launchpad stored for a token, when one was resolved before. */
  knownLaunchpad?(address: Address): string | null;
  saveTokens(rows: TokenRow[]): void;
  saveTrades(rows: StoredTrade[]): void;
  saveWallets(rows: WalletRow[]): void;
  /** Inserts signals whose dedupe key is new; returns those inserted, with ids. */
  saveSignals(rows: SignalRecord[]): SignalRecord[];
  /** Fill in the launchpad of stored tokens that were saved as unknown. */
  updateLaunchpads?(labels: Map<Address, string>): void;
  /** False once the daily write budget is spent: only signals and the trades they cite are then written. */
  canWriteTrades(): boolean;
}

export type Logger = (event: string, fields: Record<string, unknown>) => void;
export interface TickResult {
  status: "idle" | "processed" | "range-reduced";
  from: number; to: number; head: number; headTime: number | null;
  trades: Trade[]; signals: SignalRecord[]; fundingResolved: number;
}

const MAX_LOG_TX_FETCH = 400;

export class Pipeline {
  readonly detectors: Detectors;
  readonly wallets: WalletBook;
  readonly ctx: ClassifierContext;
  readonly launchpads: LaunchpadResolver;
  private readonly historyRpc: Rpc | null;
  head = 0;
  headTime: number | null = null;
  /** Observed blocks per second, used to size funding lookbacks. */
  blocksPerSecond = 5;
  private range: number;
  private readonly tokens = new Map<Address, TokenMeta>();
  private readonly waiting = new Map<Address, BuyEvent[]>();
  private readonly hourly = new Map<string, HourlyRow>();
  private lastBlockSample: { block: number; time: number } | null = null;

  private readonly env: AppEnv;
  private readonly rpc: Rpc;
  private readonly store: Store;
  private readonly price: HypePrice;
  private readonly log: Logger;
  constructor(env: AppEnv, rpc: Rpc, store: Store, price: HypePrice, log: Logger = () => {}, now: () => number = Date.now) {
    this.env = env; this.rpc = rpc; this.store = store; this.price = price; this.log = log;
    this.detectors = new Detectors(env.thresholds);
    this.wallets = new WalletBook(rpc, env.thresholds, now, { probeMaxNonce: env.fundingProbeMaxNonce, queueMax: 500 });
    this.range = env.maxRangeBlocks;
    this.historyRpc = env.chain.historyRpc.length ? new Rpc(env.chain.historyRpc, { batchMax: 2, timeoutMs: 20_000, retries: 1 }) : null;
    this.launchpads = new LaunchpadResolver(env.chain.launchpadBook, rpc, this.historyRpc, { maxHistoryLookups: env.hookLookupsPerTick, now }, (token) => store.knownLaunchpad?.(token) ?? null);
    this.ctx = {
      bases: new Map(env.chain.baseAssets.map((asset) => [asset.address, { kind: asset.kind, decimals: asset.decimals }])),
      bridges: new Set(env.chain.bridgeContracts.map((item) => item.address)),
      launchpads: env.chain.launchpads,
      hypeUsd: null,
    };
  }

  /** Process the next range. `toBlock` pins the end (replay); `drainFunding` finishes funding searches before returning. */
  async tick(options: { toBlock?: number; maxRounds?: number; drainFunding?: boolean; hypeUsd?: number | null } = {}): Promise<TickResult> {
    const t = this.env.thresholds;
    // Live: the head read in the previous tick bounds this range, and the same batch reads the new head, so a tick
    // costs one request before the transactions. Replay pins the end block instead.
    if (options.toBlock !== undefined) this.head = Math.max(this.head, options.toBlock);
    else if (this.head === 0) this.head = hexToNumber(await this.rpc.call<Hex>("eth_blockNumber", []));
    const safeHead = (options.toBlock ?? this.head - t.confirmations);
    const cursor = this.store.getCursor() ?? Math.max(0, safeHead - t.backfillBlocks);
    const from = cursor + 1; const to = Math.min(safeHead, from + this.range - 1);
    const empty: TickResult = { status: "idle", from, to: cursor, head: this.head, headTime: this.headTime, trades: [], signals: [], fundingResolved: 0 };
    if (from > to) {
      if (options.toBlock === undefined) this.head = Math.max(this.head, hexToNumber(await this.rpc.call<Hex>("eth_blockNumber", [])));
      const out = await this.funding(options, []);
      return { ...empty, head: this.head, signals: out.signals.length ? this.persist([], new Map(), out.signals) : [], fundingResolved: out.fundingResolved };
    }
    this.ctx.hypeUsd = options.hypeUsd !== undefined ? options.hypeUsd : this.price.current();

    // 1. Logs: ERC-20 transfers and WHYPE unwraps (and the new head when live).
    const logsRequest = { method: "eth_getLogs", params: [{ fromBlock: toHex(from), toBlock: toHex(to), topics: [[TRANSFER_TOPIC, WITHDRAWAL_TOPIC]] }] };
    const first = await this.rpc.batch<RawLog[] | Hex>(options.toBlock === undefined ? [logsRequest, { method: "eth_blockNumber", params: [] }] : [logsRequest]);
    if (first[1]?.ok) this.head = Math.max(this.head, hexToNumber(first[1].value as Hex));
    const logsResult = first[0] as { ok: true; value: RawLog[] } | { ok: false; error: string; kind: string };
    if (!logsResult.ok) {
      if (this.range > 10 && (logsResult.kind === "range" || logsResult.kind === "other")) {
        this.range = Math.max(10, Math.floor(this.range / 4));
        this.log("range_reduced", { range: this.range, error: logsResult.error });
        return { ...empty, status: "range-reduced" };
      }
      throw new Error(`eth_getLogs failed: ${logsResult.error}`);
    }
    if (this.range < this.env.maxRangeBlocks) this.range = Math.min(this.env.maxRangeBlocks, this.range * 2);
    const logs = logsResult.value;

    // 2. Block times: Nitro returns blockTimestamp on logs; otherwise read the headers of blocks that have logs.
    const times = new Map<number, number>();
    for (const log of logs as (RawLog & { blockTimestamp?: Hex })[]) if (log.blockTimestamp) times.set(hexToNumber(log.blockNumber), hexToNumber(log.blockTimestamp));
    const groups = groupByTx(logs);
    const candidates = [...groups].filter(([, list]) => mayBeTrade(list, this.ctx)).slice(0, MAX_LOG_TX_FETCH);
    const missingTimes = [...new Set(candidates.map(([, list]) => hexToNumber(list[0].blockNumber)))].filter((block) => !times.has(block));
    const headerBlocks = [...new Set([...missingTimes, to])];
    // Headers and transactions go out together (one batch, split only by the endpoint's batch limit).
    const second = await this.rpc.batch<{ timestamp: Hex } | RawTx | null>([
      ...headerBlocks.map((block) => ({ method: "eth_getBlockByNumber", params: [toHex(block), false] })),
      ...candidates.map(([hash]) => ({ method: "eth_getTransactionByHash", params: [hash] })),
    ]);
    const headers = second.slice(0, headerBlocks.length) as ({ ok: true; value: { timestamp: Hex } | null } | { ok: false })[];
    const txResults = second.slice(headerBlocks.length) as ({ ok: true; value: RawTx | null } | { ok: false; error: string })[];
    headers.forEach((result, index) => { if (result.ok && result.value) times.set(headerBlocks[index], hexToNumber(result.value.timestamp)); });
    const toTime = times.get(to) ?? null;
    if (toTime !== null) {
      if (this.lastBlockSample && to > this.lastBlockSample.block && toTime > this.lastBlockSample.time) {
        const rate = (to - this.lastBlockSample.block) / (toTime - this.lastBlockSample.time);
        this.blocksPerSecond = Math.min(100, Math.max(0.05, this.blocksPerSecond * 0.7 + rate * 0.3));
      }
      this.lastBlockSample = { block: to, time: toTime };
      this.headTime = toTime + Math.max(0, (this.head - to) / this.blocksPerSecond);
    }

    // 3. Classify each candidate transaction.
    const trades: Trade[] = [];
    // A refused read must not be skipped: stop before storing anything and retry this range on the next tick.
    const refused = txResults.filter((result) => !result.ok);
    if (refused.length) {
      const first = refused[0] as { ok: false; error: string; kind?: string };
      throw Object.assign(new Error(`${refused.length} of ${candidates.length} transactions could not be read (${first.error.slice(0, 80)}); retrying this range.`), { kind: first.kind ?? "other" });
    }
    candidates.forEach(([hash, list], index) => {
      const result = txResults[index];
      if (!result.ok || !result.value) { this.log("tx_missing", { hash, error: "null" }); return; }
      const time = times.get(hexToNumber(list[0].blockNumber)) ?? toTime ?? 0;
      trades.push(...classifyTx(result.value, list, time, this.ctx));
    });
    trades.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

    // 4. Token metadata for tokens not seen before.
    const unknown = [...new Set(trades.map((trade) => trade.token))].filter((token) => !this.tokens.has(token) && !this.loadToken(token));
    for (let i = 0; i < unknown.length; i += 30) {
      const chunk = unknown.slice(i, i + 30);
      const meta = await fetchTokenMeta(this.rpc, this.env.chain.multicall3, chunk).catch(() => chunk.map((address) => ({ address, symbol: null, name: null, decimals: null })));
      meta.forEach((item) => this.tokens.set(item.address, item));
    }

    // 5. Launchpads (before detectors, so signals carry them), then wallet facts and detectors.
    const labelled = await this.launchpads.resolve(trades);
    const buys = trades.filter((trade) => trade.side === "BUY");
    await this.wallets.lookupNonces(buys.map((trade) => ({ wallet: trade.wallet, block: trade.blockNumber })));
    const signals: SignalRecord[] = []; const facts = new Map<string, WalletFacts>();
    const lookback = Math.ceil(t.freshMaxAgeHours * 3600 * this.blocksPerSecond);
    for (const trade of trades) {
      const fact = this.wallets.facts(trade.wallet, trade.blockTime);
      facts.set(`${trade.txHash}:${trade.logIndex}`, fact);
      if (trade.side !== "BUY") continue;
      this.countHourly(trade, fact);
      const event: BuyEvent = { trade, facts: fact, tokenSymbol: this.tokens.get(trade.token)?.symbol ?? null, hypeUsd: this.ctx.hypeUsd };
      signals.push(...this.detectors.onBuy(event));
      if (this.wallets.enqueueFunding(trade.wallet, trade.blockNumber, lookback) || fact.fundingKind === "pending") {
        const list = this.waiting.get(trade.wallet) ?? [];
        list.push(event); if (list.length > 20) list.shift();
        this.waiting.set(trade.wallet, list);
      }
    }
    const fundingOut = await this.funding(options, signals);
    const lastTime = trades.at(-1)?.blockTime ?? toTime;
    if (lastTime) this.detectors.prune(lastTime);

    // 6. Persist and advance.
    const inserted = this.persist(trades, facts, fundingOut.signals);
    if (labelled.size) this.store.updateLaunchpads?.(labelled);
    this.store.setCursor(to);
    for (const trade of trades) if (this.env.thresholds.storeMinHype <= (trade.amountInHype ?? 0)) this.log("trade", { side: trade.side, token: trade.token, wallet: trade.wallet, hype: trade.amountInHype, block: trade.blockNumber, tx: trade.txHash });
    return { status: "processed", from, to, head: this.head, headTime: this.headTime, trades, signals: inserted, fundingResolved: fundingOut.fundingResolved };
  }

  /** Spare subrequests: run more funding search rounds and store any signals they complete. */
  async extraFunding(rounds: number): Promise<SignalRecord[]> {
    if (rounds <= 0 || !this.wallets.pending) return [];
    const out = await this.funding({ maxRounds: rounds }, []);
    return out.signals.length ? this.persist([], new Map(), out.signals) : [];
  }

  /** Advance funding searches and re-run detectors for buys whose wallet funding became known. */
  private async funding(options: { maxRounds?: number; drainFunding?: boolean }, signals: SignalRecord[]) {
    let resolved = 0;
    const rounds = options.drainFunding ? 10_000 : options.maxRounds ?? 2;
    for (let round = 0; round < rounds && this.wallets.pending; ) {
      const step = Math.min(rounds - round, options.drainFunding ? 50 : rounds);
      const done = await this.wallets.advanceFunding(step);
      round += step;
      for (const wallet of done) {
        resolved++;
        for (const event of this.waiting.get(wallet) ?? []) {
          const fact = this.wallets.facts(wallet, event.trade.blockTime);
          signals.push(...this.detectors.onFunding({ ...event, facts: fact }));
        }
        this.waiting.delete(wallet);
      }
    }
    return { signals, fundingResolved: resolved };
  }

  private loadToken(token: Address): boolean {
    const known = this.store.knownToken(token);
    if (known) this.tokens.set(token, known);
    return Boolean(known);
  }

  private countHourly(trade: Trade, fact: WalletFacts) {
    const hour = Math.floor(trade.blockTime / 3600) * 3600;
    const id = `${trade.token}:${hour}`;
    const row = this.hourly.get(id) ?? { token: trade.token, hour, buys: 0, freshBuys: 0, whaleBuys: 0, volumeHype: 0 };
    row.buys++; if (fact.fresh) row.freshBuys++;
    if ((trade.amountInHype ?? 0) >= this.env.thresholds.whaleMinHype) row.whaleBuys++;
    row.volumeHype += trade.amountInHype ?? 0;
    this.hourly.set(id, row);
  }

  /** Hourly per-token counts gathered since the last call (flushed by the indexer on its own schedule). */
  takeHourly(): HourlyRow[] { const rows = [...this.hourly.values()]; this.hourly.clear(); return rows; }
  /** Unflushed hourly counts for one token since `sinceSec`. */
  peekHourly(token: string, sinceSec: number) {
    const out = { buys: 0, freshBuys: 0, whaleBuys: 0, volumeHype: 0 };
    for (const row of this.hourly.values()) if (row.token === token && row.hour >= sinceSec - 3600) { out.buys += row.buys; out.freshBuys += row.freshBuys; out.whaleBuys += row.whaleBuys; out.volumeHype += row.volumeHype; }
    return out;
  }

  private persist(trades: Trade[], facts: Map<string, WalletFacts>, signals: SignalRecord[]): SignalRecord[] {
    const cited = new Set(signals.flatMap((signal) => signal.tradeKeys));
    const byKey = new Map(trades.map((trade) => [`${trade.txHash}:${trade.logIndex}`, trade]));
    for (const id of cited) if (!byKey.has(id)) { const held = this.detectors.held.get(id); if (held) byKey.set(id, held); }
    const writeAll = this.store.canWriteTrades();
    const keep = [...byKey].filter(([id, trade]) => cited.has(id) || (writeAll && (trade.amountInHype ?? 0) >= this.env.thresholds.storeMinHype));
    const rows: StoredTrade[] = keep.map(([id, trade]) => {
      const fact = facts.get(id) ?? this.wallets.facts(trade.wallet, trade.blockTime);
      return { ...trade, walletNonce: fact.nonce, fresh: fact.fresh };
    });
    const tokenRows: TokenRow[] = [...new Set(rows.map((row) => row.token))].map((address) => {
      const meta = this.tokens.get(address) ?? { address, symbol: null, name: null, decimals: null };
      const first = rows.find((row) => row.token === address)!;
      return { ...meta, firstSeenBlock: first.blockNumber, firstSeenAt: first.blockTime, launchpad: first.launchpad };
    });
    const walletIds = new Set([...rows.map((row) => row.wallet), ...signals.flatMap((signal) => signal.clusterWallets ?? [])]);
    const walletRows: WalletRow[] = [...walletIds].map((address) => {
      const fact = this.wallets.facts(address, 0);
      const first = rows.find((row) => row.wallet === address);
      return { address, firstSeenAt: first?.blockTime ?? 0, nonce: fact.nonce, fundedBy: fact.fundedBy, fundedAt: fact.fundedAt, fundingKind: fact.fundingKind };
    });
    this.store.saveTokens(tokenRows);
    this.store.saveWallets(walletRows);
    this.store.saveTrades(rows);
    for (const signal of signals) signal.tokenSymbol ??= this.tokens.get(signal.token)?.symbol ?? null;
    return this.store.saveSignals(signals);
  }

  /** Both RPC clients draw on the same per-invocation subrequest budget. */
  setBudget(budget: Budget) { this.rpc.budget = budget; if (this.historyRpc) this.historyRpc.budget = budget; }

  /** Symbol for a token the pipeline has seen, for messages. */
  symbol(token: Address) { return this.tokens.get(token)?.symbol ?? null; }
}
