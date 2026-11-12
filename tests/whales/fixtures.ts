// Fixture builders for classifier and detector tests. Addresses are made up for tests only and never used at runtime.

import { TRANSFER_TOPIC, WITHDRAWAL_TOPIC, type ClassifierContext } from "../../worker/whales/classify.ts";
import type { Address, Hex, RawLog, RawTx, Thresholds, Trade, WalletFacts } from "../../worker/whales/types.ts";

export const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
export const WHYPE = A(0xa1); export const USDC = A(0xa2); export const GATEWAY = A(0xb1);
export const ROUTER = A(0xc1); export const POOL = A(0xc2); export const POOL2 = A(0xc3);
export const TOKEN = A(0xd1); export const TOKEN2 = A(0xd2);
export const USER = A(0xe1);
export const HYPE = 10n ** 18n;

export const ctx = (hypeUsd: number | null = 40): ClassifierContext => ({
  bases: new Map([[WHYPE, { kind: "whype", decimals: 18 }], [USDC, { kind: "usdc", decimals: 6 }]]),
  bridges: new Set([GATEWAY]),
  launchpads: new Map([[ROUTER, "TestPad"]]),
  hypeUsd,
});

const topic = (address: Address) => `0x${address.slice(2).padStart(64, "0")}` as Hex;
const amount = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
let logIndex = 0;
export function transfer(token: Address, from: Address, to: Address, value: bigint, hash: Hex = "0x01"): RawLog {
  return { address: token, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: amount(value), logIndex: `0x${(logIndex++).toString(16)}`, transactionHash: hash, blockNumber: "0x64" };
}
export function withdrawal(token: Address, src: Address, value: bigint, hash: Hex = "0x01"): RawLog {
  return { address: token, topics: [WITHDRAWAL_TOPIC, topic(src)], data: amount(value), logIndex: `0x${(logIndex++).toString(16)}`, transactionHash: hash, blockNumber: "0x64" };
}
export function tx(fields: Partial<RawTx> = {}): RawTx {
  return { hash: "0x01", from: USER, to: ROUTER, value: "0x0", type: "0x2", blockNumber: "0x64", ...fields };
}

export const thresholds = (patch: Partial<Thresholds> = {}): Thresholds => ({
  whaleMinHype: 50, freshMinHype: 5, freshMaxNonce: 5, freshMaxAgeHours: 24, accumMinBuys: 3, accumWindowMin: 360, accumMinTotalHype: 5,
  clusterMinWallets: 3, clusterWindowMin: 10, confirmations: 1, backfillBlocks: 0, storeMinHype: 2, ...patch,
});

let seq = 0;
export function buy(fields: Partial<Trade> = {}): Trade {
  seq++;
  return {
    txHash: `0x${seq.toString(16).padStart(64, "0")}` as Hex, logIndex: 0, blockNumber: 100 + seq, blockTime: 1_700_000_000, wallet: USER, token: TOKEN, side: "BUY",
    amountToken: 1000n, amountInHype: 1, baseAsset: "HYPE", launchpad: "unknown", txTo: ROUTER, venue: POOL, ...fields,
  };
}
export const facts = (patch: Partial<WalletFacts> = {}): WalletFacts => ({ nonce: 50, nonceAtBlock: true, fundedBy: null, fundedAt: null, fundingKind: "unknown", fresh: false, ...patch });
