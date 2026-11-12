// Whale watch: classifies a transaction's net flows into a trade (buy or sell, which token, how much HYPE).
// Launchpad-agnostic buy/sell classifier (rule flows-v1). A transaction is judged only by the net token flows of the
// account that sent it (tx.from):
//   BUY  = tx.from spends a base asset (native HYPE via tx.value, WHYPE, USDC) and receives a non-base ERC-20.
//   SELL = tx.from sends away a non-base ERC-20 and receives a base asset (WHYPE, USDC, or HYPE unwrapped from WHYPE).
// Bridge moves (any transfer to or from a bridge contract, or a tx sent to one) and ArbOS system/deposit transactions
// are never trades. No per-launchpad ABI is used.
//
// Known blind spots, stated in the public docs: HYPE paid out natively by a pool without a WHYPE unwrap is invisible
// (no log), so such sells are missed; native HYPE refunded to the buyer without a log is counted as spent.

import { toEventSelector } from "viem";
import type { Address, Hex, RawLog, RawTx, Trade } from "./types.ts";

export const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
export const WITHDRAWAL_TOPIC = toEventSelector("Withdrawal(address,uint256)");
const ZERO = "0x0000000000000000000000000000000000000000";
const WEI = 10n ** 18n;
/** Arbitrum ArbOS transaction types: deposit (0x64), unsigned/contract (0x65, 0x66), retry (0x68), submit retryable (0x69), internal (0x6a). */
const SYSTEM_TX_TYPES = new Set(["0x64", "0x65", "0x66", "0x68", "0x69", "0x6a"]);

export interface ClassifierContext {
  bases: Map<Address, { kind: "whype" | "usdc"; decimals: number }>;
  bridges: Set<Address>;
  launchpads: Map<Address, string>;
  /** HYPE price in USD, used only to convert USDC legs. */
  hypeUsd: number | null;
}

export interface ParsedTransfer { token: Address; from: Address; to: Address; value: bigint; logIndex: number }

const topicAddress = (topic: Hex | undefined): Address | null =>
  topic && /^0x[0-9a-fA-F]{64}$/.test(topic) ? `0x${topic.slice(26).toLowerCase()}` as Address : null;
const word = (data: Hex): bigint | null => (/^0x[0-9a-fA-F]{64}/.test(data) ? BigInt(data.slice(0, 66)) : data === "0x" ? 0n : null);

/** ERC-20 Transfer logs only: three topics (ERC-721 has four) and a 32-byte amount. */
export function parseTransfer(log: RawLog): ParsedTransfer | null {
  if (log.removed || log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) return null;
  const from = topicAddress(log.topics[1]); const to = topicAddress(log.topics[2]); const value = word(log.data);
  if (!from || !to || value === null) return null;
  return { token: log.address.toLowerCase() as Address, from, to, value, logIndex: Number(BigInt(log.logIndex)) };
}

const toHype = (wei: bigint) => Number(wei / 10n ** 6n) / 1e12;
const units = (raw: bigint, decimals: number) => Number(raw) / 10 ** decimals;

export function classifyTx(tx: RawTx, logs: RawLog[], blockTime: number, ctx: ClassifierContext): Trade[] {
  if (tx.type && SYSTEM_TX_TYPES.has(tx.type.toLowerCase())) return [];
  const from = tx.from.toLowerCase() as Address;
  const to = tx.to ? tx.to.toLowerCase() as Address : null;
  if (to && ctx.bridges.has(to)) return [];

  const deltas = new Map<Address, bigint>();
  const firstLog = new Map<Address, number>();
  const firstFrom = new Map<Address, Address>(); const lastTo = new Map<Address, Address>();
  let unwrapped = 0n;
  for (const log of logs) {
    if (log.removed) continue;
    const address = log.address.toLowerCase() as Address;
    if (log.topics[0] === WITHDRAWAL_TOPIC && ctx.bases.get(address)?.kind === "whype") {
      const wad = word(log.data);
      if (wad !== null) unwrapped += wad;
      continue;
    }
    const transfer = parseTransfer(log);
    if (!transfer) continue;
    if (ctx.bridges.has(transfer.to) || ctx.bridges.has(transfer.from)) return [];
    if (transfer.from === transfer.to) continue;
    if (!firstFrom.has(transfer.token)) firstFrom.set(transfer.token, transfer.from);
    lastTo.set(transfer.token, transfer.to);
    if (transfer.from === from) deltas.set(transfer.token, (deltas.get(transfer.token) ?? 0n) - transfer.value);
    if (transfer.to === from) deltas.set(transfer.token, (deltas.get(transfer.token) ?? 0n) + transfer.value);
    if ((transfer.from === from || transfer.to === from) && !firstLog.has(transfer.token)) firstLog.set(transfer.token, transfer.logIndex);
  }

  let whypeNet = 0n; let usdcNet = 0; let usdcUsed = false;
  const received: [Address, bigint][] = []; const sent: [Address, bigint][] = [];
  for (const [token, delta] of deltas) {
    if (delta === 0n || token === ZERO) continue;
    const base = ctx.bases.get(token);
    if (base?.kind === "whype") whypeNet += delta;
    else if (base?.kind === "usdc") { usdcNet += units(delta, base.decimals); usdcUsed = true; }
    else if (delta > 0n) received.push([token, delta]);
    else sent.push([token, -delta]);
  }
  const value = BigInt(tx.value || "0x0");
  const blockNumber = Number(BigInt(tx.blockNumber ?? "0x0"));
  const launchpad = (to && ctx.launchpads.get(to)) ?? "unknown";
  const usdcAsHype = usdcUsed ? (ctx.hypeUsd && ctx.hypeUsd > 0 ? usdcNet / ctx.hypeUsd : null) : 0;

  const make = (side: Trade["side"], list: [Address, bigint][], totalHype: number | null, baseAsset: Trade["baseAsset"]): Trade[] =>
    list.map(([token, amount]) => ({
      txHash: tx.hash.toLowerCase() as Hex, logIndex: firstLog.get(token) ?? 0, blockNumber, blockTime, wallet: from, token, side,
      amountToken: amount, amountInHype: totalHype === null ? null : totalHype / list.length, baseAsset, launchpad, txTo: to,
      venue: (side === "BUY" ? firstFrom.get(token) : lastTo.get(token)) ?? null,
    }));

  // BUY: base spent, launch token received. Native HYPE refunded through a WHYPE unwrap is netted out.
  const spentWei = value - whypeNet - unwrapped;
  if (received.length && (spentWei > 0n || usdcNet < 0)) {
    const paidWithUsdc = usdcNet < 0;
    if (paidWithUsdc && usdcAsHype === null) return make("BUY", received, null, "USDC");
    const total = (spentWei > 0n ? toHype(spentWei) : 0) + (paidWithUsdc ? -(usdcAsHype as number) : 0);
    if (total <= 0) return [];
    const legs = [value > 0n ? "HYPE" : null, whypeNet < 0n ? "WHYPE" : null, paidWithUsdc ? "USDC" : null].filter(Boolean);
    return make("BUY", received, total, legs.length === 1 ? legs[0] as Trade["baseAsset"] : legs.length ? "mixed" : "HYPE");
  }
  // SELL: launch token sent away, base received (WHYPE, USDC, or HYPE unwrapped from WHYPE in the same tx).
  const gotWei = whypeNet + unwrapped - value;
  if (sent.length && !received.length && (gotWei > 0n || usdcNet > 0)) {
    if (usdcNet > 0 && usdcAsHype === null) return make("SELL", sent, null, "USDC");
    const total = (gotWei > 0n ? toHype(gotWei) : 0) + (usdcNet > 0 ? (usdcAsHype as number) : 0);
    if (total <= 0) return [];
    const legs = [unwrapped > 0n ? "HYPE" : null, whypeNet > 0n ? "WHYPE" : null, usdcNet > 0 ? "USDC" : null].filter(Boolean);
    return make("SELL", sent, total, legs.length === 1 ? legs[0] as Trade["baseAsset"] : "mixed");
  }
  return [];
}

/** Group logs by transaction, in log order. */
export function groupByTx(logs: RawLog[]): Map<Hex, RawLog[]> {
  const out = new Map<Hex, RawLog[]>();
  for (const log of logs) {
    const key = log.transactionHash.toLowerCase() as Hex;
    const list = out.get(key);
    if (list) list.push(log); else out.set(key, [log]);
  }
  for (const list of out.values()) list.sort((a, b) => Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  return out;
}

/** True when a tx's logs could hold a trade for some sender: at least one ERC-20 transfer of a non-base token. */
export function mayBeTrade(logs: RawLog[], ctx: Pick<ClassifierContext, "bases">): boolean {
  return logs.some((log) => { const transfer = parseTransfer(log); return transfer !== null && !ctx.bases.has(transfer.token); });
}

export const WEI_PER_HYPE = WEI;
