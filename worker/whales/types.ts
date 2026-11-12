// Whale watch: shared types for the classifier and detectors.
// Shared types for the indexer, the API and the web app. Addresses are lower-case 0x strings everywhere.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Side = "BUY" | "SELL";
export type SignalType = "WHALE_BUY" | "FRESH_BUY" | "ACCUMULATION" | "CLUSTER";
export const SIGNAL_TYPES: readonly SignalType[] = ["WHALE_BUY", "FRESH_BUY", "ACCUMULATION", "CLUSTER"];

/** An ERC-20 Transfer (or WHYPE Withdrawal) log as returned by eth_getLogs. */
export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  logIndex: Hex;
  transactionHash: Hex;
  blockNumber: Hex;
  removed?: boolean;
}

/** The fields of eth_getTransactionByHash the classifier needs. */
export interface RawTx {
  hash: Hex;
  from: Address;
  to: Address | null;
  value: Hex;
  type?: Hex;
  blockNumber: Hex | null;
}

/** A classified trade before enrichment. `amountInHype` is null when a USDC leg has no price. */
export interface Trade {
  txHash: Hex;
  logIndex: number;
  blockNumber: number;
  blockTime: number; // unix seconds
  wallet: Address;
  token: Address;
  side: Side;
  amountToken: bigint;
  amountInHype: number | null;
  baseAsset: "HYPE" | "WHYPE" | "USDC" | "mixed";
  launchpad: string;
  txTo: Address | null;
  /** The contract the token came from (BUY) or went to (SELL): a pool, pool manager, pad or hook. */
  venue: Address | null;
}

/** What is known about a wallet at the time of one of its buys. */
export interface WalletFacts {
  /** eth_getTransactionCount at the buy's block (it includes the buy itself). Null when the RPC could not answer. */
  nonce: number | null;
  /** True when nonce was read at the buy's block; false when only `latest` was available (an upper bound). */
  nonceAtBlock: boolean;
  fundedBy: Address | null;
  /** Unix seconds of the first funding found, or null. */
  fundedAt: number | null;
  /** How funding was found: a plain transfer, a contract call, a bridge deposit, or not found. */
  fundingKind: FundingKind;
  fresh: boolean | null;
}
export type FundingKind = "transfer" | "contract" | "bridge" | "older" | "unknown" | "pending" | "unavailable";

export interface SignalRecord {
  id?: number;
  type: SignalType;
  token: Address;
  tokenSymbol: string | null;
  wallet: Address | null;
  clusterWallets: Address[] | null;
  fundedBy: Address | null;
  tradeKeys: string[];
  amountInHype: number | null;
  hypeUsd: number | null;
  launchpad: string;
  txHash: Hex;
  blockNumber: number;
  createdAt: number; // unix ms, from the triggering buy's block time
  dedupeKey: string;
  walletNonce: number | null;
  walletFundedAt: number | null;
  buyCount?: number;
}

export interface TokenMeta {
  address: Address;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}

/** Thresholds and switches read from the environment. */
export interface Thresholds {
  whaleMinHype: number;
  freshMinHype: number;
  freshMaxNonce: number;
  freshMaxAgeHours: number;
  accumMinBuys: number;
  accumWindowMin: number;
  accumMinTotalHype: number;
  clusterMinWallets: number;
  clusterWindowMin: number;
  confirmations: number;
  backfillBlocks: number;
  storeMinHype: number;
}
