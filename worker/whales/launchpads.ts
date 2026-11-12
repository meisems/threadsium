// Launchpad attribution (rule launchpads-v1). A token's launchpad is where its pool lives, read from standard
// contract behaviour only (no per-launchpad ABI):
//   1. the venue (the contract that sent the token to the buyer) is a listed pool manager, pad, launcher or hook;
//   2. the venue is a shared Uniswap V4 PoolManager: the pool's hook comes from the manager's standard Initialize
//      event for the token (one history lookup per token), and the hook is looked up; no hook = the manager's name;
//   3. the venue is a V3-style pool: its standard factory() is a listed factory;
//   4. the address the transaction was sent to (tx.to) is a listed router;
// otherwise "unknown". A resolved name is cached per token; failed or unmatched hook lookups are retried after an hour.

import { toEventSelector } from "viem";
import type { LaunchpadBook } from "./config.ts";
import type { Rpc } from "./client.ts";
import type { Address, Hex, Trade } from "./types.ts";

export const UNKNOWN = "unknown";
const INITIALIZE = toEventSelector("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
const FACTORY_SELECTOR = "0xc45a0155"; // factory()
const ZERO = "0x0000000000000000000000000000000000000000";
const RETRY_MS = 3_600_000;
const word = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

export interface ResolverOptions { maxHistoryLookups: number; now: () => number }

export class LaunchpadResolver {
  private readonly byToken = new Map<Address, string>();
  private readonly hookTried = new Map<Address, number>();
  private readonly factoryOf = new Map<Address, Address | null>();
  /** Hooks seen on shared managers that are not in the book, with the number of tokens using them (diagnostics). */
  readonly unknownHooks = new Map<Address, number>();
  historyLookups = 0;
  historyFailures = 0;

  private readonly book: LaunchpadBook;
  private readonly rpc: Rpc;
  private readonly history: Rpc | null;
  private readonly options: ResolverOptions;
  private readonly stored: (token: Address) => string | null;
  constructor(book: LaunchpadBook, rpc: Rpc, history: Rpc | null, options: ResolverOptions = { maxHistoryLookups: 4, now: Date.now }, stored: (token: Address) => string | null = () => null) {
    this.book = book; this.rpc = rpc; this.history = history; this.options = options; this.stored = stored;
  }

  private known(token: Address): string | null {
    const hit = this.byToken.get(token);
    if (hit) return hit;
    const stored = this.stored(token);
    if (stored && stored !== UNKNOWN) { this.byToken.set(token, stored); return stored; }
    return null;
  }

  private direct(venue: Address | null): string | null {
    return venue ? this.book.venues.get(venue) ?? this.book.hooks.get(venue) ?? null : null;
  }

  /** Sets trade.launchpad for each trade. Returns the tokens newly labelled by this call. */
  async resolve(trades: Trade[]): Promise<Map<Address, string>> {
    const now = this.options.now();
    const before = new Set(this.byToken.keys());
    const open = trades.filter((trade) => !this.known(trade.token));

    // 1. Listed venues (pool managers, pads, launchers, and hooks that hold the pool's tokens).
    for (const trade of open) {
      const name = this.direct(trade.venue);
      if (name) this.byToken.set(trade.token, name);
    }

    // 2. Shared V4 managers: the pool's hook, one lookup per token (limited per call, retried after an hour).
    const v4 = new Map<Address, Address>();
    for (const trade of open) {
      if (this.byToken.has(trade.token) || !trade.venue || !this.book.sharedPoolManagers.has(trade.venue)) continue;
      const tried = this.hookTried.get(trade.token);
      if (tried === undefined || now - tried >= RETRY_MS) v4.set(trade.token, trade.venue);
    }
    let lookups = 0;
    for (const [token, manager] of v4) {
      if (lookups >= this.options.maxHistoryLookups || !this.history) break;
      lookups++;
      this.hookTried.set(token, now);
      const hook = await this.hookOf(manager, token);
      if (!hook) continue;
      const name = hook === ZERO ? this.book.sharedPoolManagers.get(manager) : this.book.hooks.get(hook);
      if (name) this.byToken.set(token, name);
      else this.unknownHooks.set(hook, (this.unknownHooks.get(hook) ?? 0) + 1);
    }

    // 3. V3-style pools: factory().
    const venues = [...new Set(open
      .filter((trade) => !this.byToken.has(trade.token) && trade.venue && trade.venue !== ZERO && !this.book.sharedPoolManagers.has(trade.venue))
      .map((trade) => trade.venue as Address))]
      .filter((venue) => !this.factoryOf.has(venue));
    if (venues.length) {
      const results = await this.rpc.batch<Hex>(venues.map((venue) => ({ method: "eth_call", params: [{ to: venue, data: FACTORY_SELECTOR }, "latest"] })));
      results.forEach((result, index) => {
        const value = result.ok && typeof result.value === "string" && /^0x[0-9a-fA-F]{64}$/.test(result.value) ? `0x${result.value.slice(26).toLowerCase()}` as Address : null;
        if (result.ok || result.kind !== "rate") this.factoryOf.set(venues[index], value);
      });
    }
    for (const trade of open) {
      if (this.byToken.has(trade.token) || !trade.venue) continue;
      const factory = this.factoryOf.get(trade.venue);
      const name = factory ? this.book.venues.get(factory) : undefined;
      if (name) this.byToken.set(trade.token, name);
    }

    // 4. Every trade: the token's launchpad, else the tx.to router, else unknown.
    for (const trade of trades) {
      const name = this.byToken.get(trade.token) ?? (trade.txTo ? this.book.routers.get(trade.txTo) : undefined);
      trade.launchpad = name ?? UNKNOWN;
    }
    const fresh = new Map<Address, string>();
    for (const [token, name] of this.byToken) if (!before.has(token)) fresh.set(token, name);
    return fresh;
  }

  /** The hook of the token's pool in a V4 manager: null when the lookup failed or found nothing, ZERO when hookless. */
  private async hookOf(manager: Address, token: Address): Promise<Address | null> {
    if (!this.history) return null;
    this.historyLookups++;
    const filter = (position: 2 | 3) => {
      const topics: (string | null)[] = [INITIALIZE, null, null, null];
      topics[position] = word(token);
      return { method: "eth_getLogs", params: [{ fromBlock: "0x0", toBlock: "latest", address: manager, topics }] };
    };
    try {
      const results = await this.history.batch<{ data: Hex }[]>([filter(3), filter(2)]);
      if (results.every((result) => !result.ok)) { this.historyFailures++; return null; }
      const logs = results.flatMap((result) => (result.ok ? result.value : []));
      if (!logs.length) return null;
      const hooks = logs.map((log) => `0x${log.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3).toLowerCase()}` as Address);
      return hooks.find((hook) => this.book.hooks.has(hook)) ?? hooks[0];
    } catch {
      this.historyFailures++;
      return null;
    }
  }

  /** Counts for /health and the survey script. */
  stats() {
    return { tokensLabelled: this.byToken.size, historyLookups: this.historyLookups, historyFailures: this.historyFailures, unknownHooks: this.unknownHooks.size };
  }
}
