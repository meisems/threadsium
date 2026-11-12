// Whale watch indexer settings. Chain facts come from chain-data.ts; the environment may pick the profile
// (WHALE_CHAIN, mainnet by default) and override endpoints and thresholds. Thresholds are clamped to sane ranges so a
// typo cannot disable a detector silently.
//
// Nodes: every Elysium RPC the profile names. The public list (Kinetiq, BOXA live and API, Elyscan) and the history
// list (Kinetiq, Volta, Elyscan) are merged, so the indexer always has a node that answers from Cloudflare (on
// 12 November 2026 Kinetiq answered 429 to the edge and only Volta answered whole-chain log searches). Requests fail
// over per call, and the watchdog (rpcwatch.ts) moves to the node that is furthest ahead or fastest. The keyed Alchemy
// endpoint is not used here: an indexer polling every few seconds would spend the swap key's monthly allowance.

import { CHAINS as chains, LAUNCHPADS as launchpads } from "./chain-data.ts";
import type { Address, Thresholds } from "./types.ts";

export type ChainName = "testnet" | "mainnet";
export interface BaseAsset { address: Address; symbol: string; kind: "whype" | "usdc"; decimals: number; source: string; todo?: string }
export interface BridgeContract { address: Address; label: string; source: string; todo?: string }
export interface ChainProfile {
  name: ChainName;
  chainId: number;
  label: string;
  isTestnet: boolean;
  provisional: boolean;
  provisionalNote: string | null;
  rpcHttp: string[];
  /** True when RPC_HTTP was set (a provider endpoint), false when the profile's public endpoints are used. */
  rpcIsProvider: boolean;
  explorerBase: string | null;
  multicall3: Address;
  baseAssets: BaseAsset[];
  bridgeContracts: BridgeContract[];
  /** tx.to -> launchpad (the prompt's attribution), used when the token's venue does not name one. */
  launchpads: Map<Address, string>;
  launchpadBook: LaunchpadBook;
  /** Endpoints that answer address-filtered eth_getLogs over the whole chain (for V4 hook lookups). */
  historyRpc: string[];
  /** Endpoint the web app may read from the visitor's browser (tracked-wallet balances). Must be in the site CSP. */
  browserRpc: string | null;
}

export interface LaunchpadBook {
  venues: Map<Address, string>;
  sharedPoolManagers: Map<Address, string>;
  hooks: Map<Address, string>;
  routers: Map<Address, string>;
}
type PadEntry = { address: string; name: string };
type PadFile = { venues?: PadEntry[]; sharedPoolManagers?: PadEntry[]; hooks?: PadEntry[]; routers?: PadEntry[] };
const padMap = (list: PadEntry[] | undefined) => new Map((list ?? []).filter((pad) => /^0x[0-9a-fA-F]{40}$/.test(pad.address)).map((pad) => [lower(pad.address), pad.name] as const));

export interface AppEnv {
  chain: ChainProfile;
  thresholds: Thresholds;
  pollMs: number;
  subrequestBudget: number;
  dailyWriteBudget: number;
  maxRangeBlocks: number;
  rpcBatchMax: number;
  /** Wallets with at most this nonce get a first-funding search (needed for CLUSTER and for "fresh by age"). */
  fundingProbeMaxNonce: number;
  /** Uniswap V4 hook lookups (history eth_getLogs) per tick, for launchpad attribution. */
  hookLookupsPerTick: number;
  publicOrigin: string | null;
  telegram: { token: string | null; channelId: string | null; channelUrl: string | null };
}

type RawEnv = Record<string, string | undefined>;
const lower = (value: string) => value.toLowerCase() as Address;
const num = (env: RawEnv, key: string, fallback: number, min: number, max: number) => {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const text = (env: RawEnv, key: string) => { const value = env[key]?.trim(); return value ? value : null; };

export function chainProfile(name: ChainName, env: RawEnv = {}): ChainProfile {
  const raw = (chains as unknown as Record<ChainName, {
    chainId: number; label: string; isTestnet: boolean; provisional: boolean; provisionalNote?: string;
    publicRpc: string[]; historyRpc?: string[]; browserRpc?: string | null; explorerBase: string | null; multicall3: string;
    baseAssets: BaseAsset[]; bridgeContracts: BridgeContract[];
  }>)[name];
  const override = text(env, "WHALE_RPC");
  const everyNode = [...new Set([...raw.publicRpc, ...(raw.historyRpc ?? [])])];
  const rpcHttp = override ? override.split(",").map((url) => url.trim()).filter((url) => /^https:\/\//.test(url)) : everyNode;
  const pads = ((launchpads as unknown as Record<string, PadFile>)[name] ?? {}) as PadFile;
  const book: LaunchpadBook = { venues: padMap(pads.venues), sharedPoolManagers: padMap(pads.sharedPoolManagers), hooks: padMap(pads.hooks), routers: padMap(pads.routers) };
  const history = text(env, "WHALE_HISTORY_RPC")?.split(",").map((url) => url.trim()).filter((url) => url.startsWith("https://")) ?? raw.historyRpc ?? [];
  return {
    name, chainId: raw.chainId, label: raw.label, isTestnet: raw.isTestnet, provisional: raw.provisional,
    provisionalNote: raw.provisionalNote ?? null,
    rpcHttp: rpcHttp.length ? rpcHttp : raw.publicRpc,
    rpcIsProvider: Boolean(override && rpcHttp.length),
    explorerBase: (text(env, "EXPLORER_URL") ?? raw.explorerBase)?.replace(/\/+$/, "") ?? null,
    multicall3: lower(raw.multicall3),
    baseAssets: raw.baseAssets.map((asset) => ({ ...asset, address: lower(asset.address) })),
    bridgeContracts: raw.bridgeContracts.map((item) => ({ ...item, address: lower(item.address) })),
    launchpads: book.routers,
    launchpadBook: book,
    historyRpc: history,
    browserRpc: raw.browserRpc && raw.browserRpc.startsWith("https://") ? raw.browserRpc : null,
  };
}

export function loadEnv(env: RawEnv): AppEnv {
  const chainName: ChainName = env.WHALE_CHAIN?.trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
  const thresholds: Thresholds = {
    whaleMinHype: num(env, "WHALE_MIN_HYPE", 50, 0.000001, 1e12),
    freshMinHype: num(env, "FRESH_MIN_HYPE", 5, 0, 1e12),
    freshMaxNonce: Math.round(num(env, "FRESH_MAX_NONCE", 5, 0, 1000)),
    freshMaxAgeHours: num(env, "FRESH_MAX_AGE_HOURS", 24, 0, 24 * 30),
    accumMinBuys: Math.round(num(env, "ACCUM_MIN_BUYS", 3, 2, 1000)),
    accumWindowMin: num(env, "ACCUM_WINDOW_MIN", 360, 1, 24 * 60),
    accumMinTotalHype: num(env, "ACCUM_MIN_TOTAL_HYPE", 5, 0, 1e12),
    clusterMinWallets: Math.round(num(env, "CLUSTER_MIN_WALLETS", 3, 2, 1000)),
    clusterWindowMin: num(env, "CLUSTER_WINDOW_MIN", 10, 1, 24 * 60),
    confirmations: Math.round(num(env, "CONFIRMATIONS", 1, 0, 1000)),
    backfillBlocks: Math.round(num(env, "BACKFILL_BLOCKS", 20_000, 0, 5_000_000)),
    // Every buy of at least this much HYPE is kept and listed under Buys.
    storeMinHype: num(env, "STORE_MIN_HYPE", 5, 0, 1e12),
  };
  const publicOrigin = text(env, "PUBLIC_ORIGIN")?.replace(/\/+$/, "") ?? null;
  return {
    chain: chainProfile(chainName, env),
    thresholds,
    pollMs: Math.round(num(env, "POLL_MS", 2000, 500, 60_000)),
    subrequestBudget: Math.round(num(env, "SUBREQUEST_BUDGET", 40, 5, 1000)),
    // Rows written a day before trade rows pause (signals keep being written). Workers Free allows 100,000 a day for
    // the whole account, and Threadsium's own posts, votes and messages need part of that.
    dailyWriteBudget: Math.round(num(env, "WHALE_WRITE_BUDGET", 50_000, 1000, 1e9)),
    maxRangeBlocks: Math.round(num(env, "MAX_RANGE_BLOCKS", 2000, 10, 100_000)),
    rpcBatchMax: Math.round(num(env, "RPC_BATCH_MAX", 20, 1, 1000)),
    hookLookupsPerTick: Math.round(num(env, "HOOK_LOOKUPS_PER_TICK", 4, 0, 1000)),
    fundingProbeMaxNonce: Math.round(num(env, "FUNDING_PROBE_MAX_NONCE", thresholds.freshMaxNonce, 0, 1000)),
    publicOrigin: publicOrigin && /^https?:\/\//.test(publicOrigin) ? publicOrigin : null,
    telegram: { token: text(env, "TELEGRAM_BOT_TOKEN"), channelId: text(env, "TELEGRAM_CHANNEL_ID"), channelUrl: text(env, "TELEGRAM_CHANNEL_URL") },
  };
}
