// Wallet facts (rule wallets-v1).
//
// Nonce: eth_getTransactionCount(wallet, buyBlock), cached so each address is read at most once an hour. A nonce above
// the fresh limit read at a block is kept for good (nonces only grow). When the RPC keeps no state for that block, the
// `latest` nonce is used and marked as an upper bound.
//
// First funding: native HYPE gas is needed before a wallet can send anything, so "funded" is monotonic before its
// first send: balance(b) > 0 or nonce(b) > 0. A k-ary search over the FRESH_MAX_AGE_HOURS lookback finds the first
// block where that holds; that block's transaction names the funder (a plain transfer, a contract call such as a
// disperse, or an ArbOS bridge deposit). It needs historical state; RPCs without it are detected and reported.

import { Rpc, toHex, hexToNumber, type RpcRequest } from "./client.ts";
import type { Address, FundingKind, Hex, Thresholds, WalletFacts } from "./types.ts";
import { isFresh } from "./detectors.ts";

interface Entry {
  nonce: number | null; nonceBlock: number; nonceAtBlock: boolean; checkedAt: number;
  fundedBy: Address | null; fundedAt: number | null; fundingKind: FundingKind;
}
interface Probe { wallet: Address; lo: number; hi: number; startChecked: boolean; queuedAt: number }
const MIN_HISTORY = 200;
/** Items per search round: Boxa's public RPC refuses batches over 20. The window start costs two items (balance and
 * nonce); every other point is one balance read, since a wallet that has not sent anything cannot lose its balance. */
const ROUND_ITEMS = 20;
const PROBE_MAX_AGE = 30 * 60_000;
const HOUR = 3_600_000;
const BRIDGE_TYPES = new Set(["0x64", "0x68", "0x69"]);
const SYSTEM_TYPES = new Set(["0x64", "0x65", "0x66", "0x68", "0x69", "0x6a"]);

export interface FundingOptions { /** Only wallets with at most this nonce get a funding search. */ probeMaxNonce: number; queueMax: number }

export class WalletBook {
  readonly entries = new Map<Address, Entry>();
  private readonly queue: Probe[] = [];
  private readonly queued = new Set<Address>();
  /** null until a historical read was tried; false when the RPC refused historical state. */
  archive: boolean | null = null;
  private archivePausedUntil = 0;
  /** Blocks of history the RPC has been seen to keep, learned from refusals; null until one happens. Re-learned every 6 h. */
  historyBlocks: number | null = null;
  private historyLearnedAt = 0;
  probesRun = 0;

  private readonly rpc: Rpc;
  private readonly t: Thresholds;
  private readonly now: () => number;
  private readonly options: FundingOptions;
  constructor(rpc: Rpc, t: Thresholds, now: () => number, options: FundingOptions = { probeMaxNonce: t.freshMaxNonce, queueMax: 500 }) {
    this.rpc = rpc; this.t = t; this.now = now; this.options = options;
  }

  /** Read nonces for buys that need one; one batch for all of them. */
  async lookupNonces(items: { wallet: Address; block: number }[]): Promise<void> {
    const need = new Map<Address, number>();
    for (const { wallet, block } of items) {
      const entry = this.entries.get(wallet);
      if (entry && entry.nonce !== null && entry.nonce > this.t.freshMaxNonce && entry.nonceAtBlock) continue;
      if (entry && this.now() - entry.checkedAt < HOUR && entry.nonce !== null) continue;
      need.set(wallet, Math.max(need.get(wallet) ?? 0, block));
    }
    if (!need.size) return;
    const list = [...need];
    const results = await this.rpc.batch<Hex>(list.map(([wallet, block]) => ({ method: "eth_getTransactionCount", params: [wallet, toHex(block)] })));
    const fallback: [Address, number][] = [];
    results.forEach((result, index) => {
      const [wallet, block] = list[index];
      if (result.ok) this.setNonce(wallet, hexToNumber(result.value), block, true);
      else fallback.push([wallet, block]);
    });
    if (!fallback.length) return;
    const latest = await this.rpc.batch<Hex>(fallback.map(([wallet]) => ({ method: "eth_getTransactionCount", params: [wallet, "latest"] })));
    latest.forEach((result, index) => { const [wallet, block] = fallback[index]; this.setNonce(wallet, result.ok ? hexToNumber(result.value) : null, block, false); });
  }

  private setNonce(wallet: Address, nonce: number | null, block: number, atBlock: boolean) {
    const entry = this.entries.get(wallet);
    if (entry) Object.assign(entry, { nonce, nonceBlock: block, nonceAtBlock: atBlock, checkedAt: this.now() });
    else this.entries.set(wallet, { nonce, nonceBlock: block, nonceAtBlock: atBlock, checkedAt: this.now(), fundedBy: null, fundedAt: null, fundingKind: "unknown" });
    if (this.entries.size > 200_000) { const first = this.entries.keys().next().value; if (first) this.entries.delete(first); }
  }

  facts(wallet: Address, blockTime: number): WalletFacts {
    const entry = this.entries.get(wallet);
    const base = { nonce: entry?.nonce ?? null, nonceAtBlock: entry?.nonceAtBlock ?? false, fundedBy: entry?.fundedBy ?? null, fundedAt: entry?.fundedAt ?? null, fundingKind: entry?.fundingKind ?? "unknown" as FundingKind };
    return { ...base, fresh: isFresh(base, blockTime, this.t) };
  }

  /** Queue a funding search for a wallet that bought at `block`, when it is new enough to be worth one. */
  enqueueFunding(wallet: Address, block: number, lookbackBlocks: number): boolean {
    const entry = this.entries.get(wallet);
    if (!entry || entry.nonce === null || entry.nonce > this.options.probeMaxNonce) return false;
    if (entry.fundingKind !== "unknown" || this.queued.has(wallet)) return false;
    if (this.archive === false && this.now() < this.archivePausedUntil) { entry.fundingKind = "unavailable"; return false; }
    if (this.queue.length >= this.options.queueMax) return false;
    if (this.historyBlocks !== null && this.now() - this.historyLearnedAt > 6 * HOUR) this.historyBlocks = null;
    const window = Math.max(1, this.historyBlocks === null ? lookbackBlocks : Math.min(lookbackBlocks, this.historyBlocks));
    entry.fundingKind = "pending";
    this.queue.push({ wallet, lo: Math.max(0, block - window), hi: block, startChecked: false, queuedAt: this.now() });
    this.queued.add(wallet);
    return true;
  }

  get pending() { return this.queue.length; }

  /** Run up to `rounds` search rounds (one RPC batch each). Returns wallets whose funding became known. */
  async advanceFunding(rounds: number): Promise<Address[]> {
    const done: Address[] = [];
    for (let i = 0; i < rounds && this.queue.length; i++) {
      const probe = this.queue[0];
      if (this.now() - probe.queuedAt > PROBE_MAX_AGE) {
        // A search that waited this long can no longer help a cluster inside its window; give the slot to newer buys.
        this.finish(probe.wallet, { fundingKind: "unknown" });
        this.queue.shift(); this.queued.delete(probe.wallet); i--; continue;
      }
      const finished = await this.step(probe).catch((error: unknown) => {
        const kind = (error as { kind?: string }).kind;
        if (kind === "state") { this.archive = false; this.archivePausedUntil = this.now() + 10 * 60_000; }
        this.finish(probe.wallet, { fundingKind: kind === "state" ? "unavailable" : "unknown" });
        return true;
      });
      if (finished) { this.queue.shift(); this.queued.delete(probe.wallet); done.push(probe.wallet); }
    }
    return done;
  }

  private finish(wallet: Address, patch: Partial<Entry>) {
    const entry = this.entries.get(wallet);
    if (entry) Object.assign(entry, patch);
  }

  private async step(probe: Probe): Promise<boolean> {
    this.probesRun++;
    if (probe.hi - probe.lo <= 1 && probe.startChecked) return this.resolveBlock(probe.wallet, probe.hi);
    const span = probe.hi - probe.lo;
    const startItems = probe.startChecked ? 0 : 2;
    const count = Math.min(ROUND_ITEMS - startItems, Math.max(0, span - 1));
    const inner: number[] = [];
    for (let k = 1; k <= count; k++) { const block = probe.lo + Math.round((span * k) / (count + 1)); if (block > probe.lo && block < probe.hi && !inner.includes(block)) inner.push(block); }
    const requests: RpcRequest[] = [
      ...(probe.startChecked ? [] : [{ method: "eth_getBalance", params: [probe.wallet, toHex(probe.lo)] }, { method: "eth_getTransactionCount", params: [probe.wallet, toHex(probe.lo)] }]),
      ...inner.map((block) => ({ method: "eth_getBalance", params: [probe.wallet, toHex(block)] })),
    ];
    const results = await this.rpc.batch<Hex>(requests);
    const stateError = results.find((result) => !result.ok && result.kind === "state");
    if (stateError && !stateError.ok) {
      // The RPC keeps less history than the lookback: search a shorter window ending at the buy instead. A wallet funded
      // before it is reported as funded earlier than the window, not as unknown.
      const window = Math.floor((probe.hi - probe.lo) / 2);
      if (window < MIN_HISTORY) throw Object.assign(new Error(stateError.error), { kind: "state" });
      this.historyBlocks = Math.min(this.historyBlocks ?? window, window);
      this.historyLearnedAt = this.now();
      probe.lo = probe.hi - window; probe.startChecked = false;
      return false;
    }
    if (results.some((result) => !result.ok)) throw Object.assign(new Error("probe read failed"), { kind: "other" });
    this.archive = true;
    const positive = (result: (typeof results)[number] | undefined) => Boolean(result?.ok && BigInt(result.value) > 0n);
    if (!probe.startChecked) {
      probe.startChecked = true;
      if (positive(results[0]) || positive(results[1])) { this.finish(probe.wallet, { fundingKind: "older" }); return true; }
    }
    const blocks = inner;
    const funded = inner.map((_, index) => positive(results[startItems + index]));
    const firstTrue = funded.findIndex(Boolean);
    if (firstTrue >= 0) probe.hi = blocks[firstTrue];
    const lastFalse = firstTrue >= 0 ? firstTrue - 1 : blocks.length - 1;
    if (lastFalse >= 0) probe.lo = Math.max(probe.lo, blocks[lastFalse]);
    if (probe.hi - probe.lo <= 1) return this.resolveBlock(probe.wallet, probe.hi);
    return false;
  }

  /** The funding block is known: read it and name the funder. */
  private async resolveBlock(wallet: Address, block: number): Promise<boolean> {
    const body = await this.rpc.call<{ timestamp: Hex; transactions: { from: Address; to: Address | null; value: Hex; type?: Hex }[] } | null>("eth_getBlockByNumber", [toHex(block), true]);
    if (!body) { this.finish(wallet, { fundingKind: "unknown" }); return true; }
    const fundedAt = hexToNumber(body.timestamp);
    const direct = body.transactions.find((tx) => tx.to?.toLowerCase() === wallet && BigInt(tx.value) > 0n);
    if (direct) {
      const bridge = direct.type ? BRIDGE_TYPES.has(direct.type.toLowerCase()) : false;
      this.finish(wallet, { fundedBy: direct.from.toLowerCase() as Address, fundedAt, fundingKind: bridge ? "bridge" : "transfer" });
      return true;
    }
    const user = body.transactions.filter((tx) => !tx.type || !SYSTEM_TYPES.has(tx.type.toLowerCase()));
    if (user.length === 1) this.finish(wallet, { fundedBy: user[0].from.toLowerCase() as Address, fundedAt, fundingKind: "contract" });
    else this.finish(wallet, { fundedAt, fundingKind: "unknown" });
    return true;
  }

  pruneCache(maxAgeMs = 24 * HOUR) {
    const cutoff = this.now() - maxAgeMs;
    for (const [wallet, entry] of this.entries) if (entry.checkedAt < cutoff && !this.queued.has(wallet)) this.entries.delete(wallet);
  }
}
