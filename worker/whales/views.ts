// JSON shapes the API returns and the web app reads. Kept in one place so both sides agree.

import type { SignalRow, TradeRow } from "./store.ts";
import type { SignalType } from "./types.ts";
import type { RpcCheck } from "./rpcwatch.ts";

export interface SignalView {
  id: number; type: SignalType; token: string; symbol: string | null; wallet: string | null;
  clusterWallets: string[] | null; fundedBy: string | null; amountHype: number | null;
  /** USD at the HYPE price when the signal was detected; null when no price was available. */
  amountUsd: number | null; launchpad: string; txHash: string; blockNumber: number; time: number;
  walletNonce: number | null; walletFundedAt: number | null; buyCount: number | null;
}
export interface TradeView { txHash: string; blockNumber: number; time: number; wallet: string; token: string; symbol: string | null; side: string; amountHype: number | null; baseAsset: string; launchpad: string; walletNonce: number | null; fresh: boolean | null }

export interface PublicConfig {
  chain: "testnet" | "mainnet"; chainId: number; label: string; isTestnet: boolean; provisional: boolean; provisionalNote: string | null;
  explorerBase: string | null; telegramChannelUrl: string | null; nativeSymbol: "HYPE";
  /** Host of the RPC the indexer reads first; null when it is a provider URL (which may hold a key). */
  rpcHost: string | null;
  /** Public RPC the browser may read for tracked-wallet balances; null when none is allowed. */
  browserRpc: string | null;
  thresholds: { whaleMinHype: number; freshMinHype: number; freshMaxNonce: number; freshMaxAgeHours: number; accumMinBuys: number; accumWindowMin: number; accumMinTotalHype: number; clusterMinWallets: number; clusterWindowMin: number; storeMinHype: number; confirmations: number };
}

export interface HealthView {
  ok: boolean; chain: string; chainId: number; head: number | null; headTime: number | null; lastProcessed: number | null;
  lagBlocks: number | null; lagSeconds: number | null; lastTickAt: number | null; lastError: string | null; lastErrorAt: number | null;
  mode: "starting" | "backfill" | "live" | "stalled"; rpcHost: string; rpcIsProvider: boolean; fundingLookups: "available" | "unavailable" | "untested";
  fundingQueue: number; writes: { day: string; used: number; budget: number; tradesPaused: boolean; bySinceStart: Record<string, number> }; sseClients: number; telegram: "off" | "on";
  blocksPerSecond: number; hypeUsd: number | null; now: number;
  /** Alarm invocations and RPC/HTTP subrequests since this indexer instance started (free-tier usage visibility). */
  loop: { since: number; invocations: number; subrequests: number };
  /** Tokens labelled / still unknown since start, and the V4 hook lookups made. */
  launchpads: { tokensLabelled: number; historyLookups: number; historyFailures: number; unknownHooks: number };
  /** RPC watchdog: endpoints in order, the one in use, seconds since the head/cursor last moved, and the last check. */
  rpc: { endpoints: string[]; current: string; idleSeconds: number; checks: number; switches: number; lastCheck: RpcCheck | null;
    /** Request-level failovers by the RPC client, and the last one with the error that caused it. */
    failovers: number; lastFailover: { at: number; from: string; to: string; reason: string; methods: string } | null };
}

export interface StatsView {
  windowHours: 24; counts: Record<SignalType, number>;
  topTokens: { token: string; symbol: string | null; whaleVolumeHype: number; whaleBuys: number }[];
  since: number;
}

export interface TokenView {
  address: string; symbol: string | null; name: string | null; decimals: number | null; firstSeenAt: number | null; firstSeenBlock: number | null; launchpad: string | null;
  stats24h: { buys: number; whaleBuys: number; freshBuys: number; freshShare: number | null; volumeHype: number };
  trades: TradeView[]; signals: SignalView[];
}

export interface WalletView {
  address: string; firstSeenAt: number | null; nonce: number | null; fundedBy: string | null; fundedAt: number | null; fundingKind: string | null;
  fresh: boolean | null; trades: TradeView[]; signals: SignalView[]; clusterSignals: SignalView[]; siblings: string[];
}

export function signalView(row: SignalRow): SignalView {
  return {
    id: row.id, type: row.type, token: row.token, symbol: row.tokenSymbol, wallet: row.wallet, clusterWallets: row.clusterWallets, fundedBy: row.fundedBy,
    amountHype: row.amountInHype, amountUsd: row.amountInHype !== null && row.hypeUsd ? row.amountInHype * row.hypeUsd : null, launchpad: row.launchpad,
    txHash: row.txHash, blockNumber: row.blockNumber, time: row.createdAt, walletNonce: row.walletNonce, walletFundedAt: row.walletFundedAt, buyCount: row.buyCount ?? null,
  };
}

export function tradeView(row: TradeRow): TradeView {
  return {
    txHash: row.txHash, blockNumber: row.blockNumber, time: row.blockTime * 1000, wallet: row.wallet, token: row.token, symbol: row.symbol ?? null, side: row.side,
    amountHype: row.amountInHype, baseAsset: row.baseAsset, launchpad: row.launchpad, walletNonce: row.walletNonce, fresh: row.fresh,
  };
}
