// Whale watch detectors. The constructor spells out its parameter property so Node can run it with type stripping (npm test).
// The four detectors (rule signals-v1). They are pure and driven by block time, never wall-clock time, so replaying
// the same block range with the same wallet facts produces the same signals.
//
//   WHALE_BUY    amount_in_hype >= WHALE_MIN_HYPE
//   FRESH_BUY    wallet is fresh and amount_in_hype >= FRESH_MIN_HYPE
//   ACCUMULATION same wallet + token, >= ACCUM_MIN_BUYS buys within ACCUM_WINDOW_MIN, together >= ACCUM_MIN_TOTAL_HYPE
//   CLUSTER      >= CLUSTER_MIN_WALLETS fresh wallets, same token, within CLUSTER_WINDOW_MIN, same funded_by
//
// Dedupe: ACCUMULATION fires once per (wallet, token) and then stays quiet until the window has passed since it
// fired; CLUSTER likewise per (funder, token). The dedupe key names the window start so a database UNIQUE index
// enforces the same rule across restarts.

import type { Address, SignalRecord, Thresholds, Trade, WalletFacts } from "./types.ts";

export interface BuyEvent { trade: Trade; facts: WalletFacts; tokenSymbol: string | null; hypeUsd: number | null }
const key = (trade: Trade) => `${trade.txHash}:${trade.logIndex}`;

/** A wallet is fresh when its nonce at the buy is small, or it was first funded within FRESH_MAX_AGE_HOURS. */
export function isFresh(facts: Pick<WalletFacts, "nonce" | "nonceAtBlock" | "fundedAt">, blockTime: number, t: Thresholds): boolean | null {
  if (facts.fundedAt !== null && blockTime - facts.fundedAt <= t.freshMaxAgeHours * 3600 && blockTime >= facts.fundedAt) return true;
  if (facts.nonce === null) return null;
  if (facts.nonce <= t.freshMaxNonce) return true;
  // A nonce read at `latest` is an upper bound: above the limit it proves nothing about the buy's moment.
  return facts.nonceAtBlock ? false : null;
}

function base(event: BuyEvent, type: SignalRecord["type"], dedupeKey: string): SignalRecord {
  const { trade, facts } = event;
  return {
    type, token: trade.token, tokenSymbol: event.tokenSymbol, wallet: trade.wallet, clusterWallets: null, fundedBy: facts.fundedBy,
    tradeKeys: [key(trade)], amountInHype: trade.amountInHype, hypeUsd: event.hypeUsd, launchpad: trade.launchpad,
    txHash: trade.txHash, blockNumber: trade.blockNumber, createdAt: trade.blockTime * 1000, dedupeKey,
    walletNonce: facts.nonce, walletFundedAt: facts.fundedAt,
  };
}

interface WindowBuy { time: number; hype: number; trade: Trade }
interface ClusterBuy { time: number; wallet: Address; funder: Address; trade: Trade; hype: number }

export class Detectors {
  private readonly accum = new Map<string, WindowBuy[]>();
  private readonly accumFired = new Map<string, number>();
  private readonly cluster = new Map<Address, ClusterBuy[]>();
  private readonly clusterFired = new Map<string, number>();
  /** Trades held by the windows, so a signal can persist every trade it cites. */
  readonly held = new Map<string, Trade>();

  private readonly t: Thresholds;
  constructor(t: Thresholds) { this.t = t; }

  /** Evaluate one buy. Funding may arrive later for CLUSTER: call `onFunding` then. */
  onBuy(event: BuyEvent): SignalRecord[] {
    const { trade, facts } = event;
    if (trade.side !== "BUY") return [];
    const out: SignalRecord[] = [];
    const hype = trade.amountInHype;
    if (hype !== null && hype >= this.t.whaleMinHype) out.push(base(event, "WHALE_BUY", `WHALE_BUY:${key(trade)}`));
    if (hype !== null && facts.fresh === true && hype >= this.t.freshMinHype) out.push(base(event, "FRESH_BUY", `FRESH_BUY:${key(trade)}`));

    // ACCUMULATION
    const pair = `${trade.wallet}:${trade.token}`;
    const windowSec = this.t.accumWindowMin * 60;
    const list = (this.accum.get(pair) ?? []).filter((item) => item.time > trade.blockTime - windowSec);
    list.push({ time: trade.blockTime, hype: hype ?? 0, trade });
    this.accum.set(pair, list);
    this.hold(trade);
    const fired = this.accumFired.get(pair);
    const quiet = fired !== undefined && trade.blockTime < fired + windowSec;
    const total = list.reduce((sum, item) => sum + item.hype, 0);
    if (!quiet && list.length >= this.t.accumMinBuys && total >= this.t.accumMinTotalHype) {
      this.accumFired.set(pair, trade.blockTime);
      out.push({
        ...base(event, "ACCUMULATION", `ACCUMULATION:${pair}:${list[0].time}`),
        tradeKeys: list.map((item) => key(item.trade)), amountInHype: total, buyCount: list.length,
      });
    }

    if (facts.fresh === true && facts.fundedBy) out.push(...this.clusterCheck(event, facts.fundedBy));
    return out;
  }

  /** Funding found after the buy was processed (an async lookup). A wallet can turn fresh by age, so FRESH_BUY is
   * re-checked (its dedupe key stops a repeat), then CLUSTER for that buy. */
  onFunding(event: BuyEvent): SignalRecord[] {
    if (event.trade.side !== "BUY" || event.facts.fresh !== true) return [];
    const out: SignalRecord[] = [];
    const hype = event.trade.amountInHype;
    if (hype !== null && hype >= this.t.freshMinHype) out.push(base(event, "FRESH_BUY", `FRESH_BUY:${key(event.trade)}`));
    if (event.facts.fundedBy) out.push(...this.clusterCheck(event, event.facts.fundedBy));
    return out;
  }

  private clusterCheck(event: BuyEvent, funder: Address): SignalRecord[] {
    const { trade } = event;
    const windowSec = this.t.clusterWindowMin * 60;
    const list = (this.cluster.get(trade.token) ?? []).filter((item) => Math.abs(item.time - trade.blockTime) <= windowSec);
    if (!list.some((item) => item.wallet === trade.wallet && item.trade.txHash === trade.txHash)) list.push({ time: trade.blockTime, wallet: trade.wallet, funder, trade, hype: trade.amountInHype ?? 0 });
    list.sort((a, b) => a.time - b.time);
    this.cluster.set(trade.token, list);
    this.hold(trade);
    const group = list.filter((item) => item.funder === funder);
    const wallets = [...new Set(group.map((item) => item.wallet))];
    if (wallets.length < this.t.clusterMinWallets) return [];
    const firedKey = `${funder}:${trade.token}`;
    const fired = this.clusterFired.get(firedKey);
    const start = group[0].time;
    if (fired !== undefined && start < fired + windowSec) return [];
    const last = group[group.length - 1];
    this.clusterFired.set(firedKey, last.time);
    return [{
      ...base({ ...event, trade: last.trade }, "CLUSTER", `CLUSTER:${funder}:${trade.token}:${start}`),
      wallet: null, clusterWallets: wallets, fundedBy: funder, tradeKeys: group.map((item) => key(item.trade)),
      amountInHype: group.reduce((sum, item) => sum + item.hype, 0), buyCount: group.length,
    }];
  }

  private hold(trade: Trade) { this.held.set(key(trade), trade); }

  /** Drop window entries older than the longest window, measured from `now` (unix seconds of the newest block). */
  prune(now: number) {
    const accumSec = this.t.accumWindowMin * 60; const clusterSec = this.t.clusterWindowMin * 60;
    const keep = new Set<string>();
    for (const [pair, list] of this.accum) {
      const next = list.filter((item) => item.time > now - accumSec);
      if (next.length) { this.accum.set(pair, next); next.forEach((item) => keep.add(key(item.trade))); } else this.accum.delete(pair);
    }
    for (const [token, list] of this.cluster) {
      const next = list.filter((item) => item.time > now - clusterSec * 2);
      if (next.length) { this.cluster.set(token, next); next.forEach((item) => keep.add(key(item.trade))); } else this.cluster.delete(token);
    }
    for (const [pair, time] of this.accumFired) if (time < now - accumSec) this.accumFired.delete(pair);
    for (const [pair, time] of this.clusterFired) if (time < now - clusterSec) this.clusterFired.delete(pair);
    for (const id of this.held.keys()) if (!keep.has(id)) this.held.delete(id);
  }

  get size() { let n = 0; for (const list of this.accum.values()) n += list.length; return n; }
}
