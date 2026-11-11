// Send / tip: checks a transfer against its on-chain receipt before it is stored as a direct message, so a message
// bubble can never claim an amount, token or recipient the chain does not show.
import { decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";
import type { Env } from "./env.ts";
import { call } from "./rpc.ts";

export interface VerifiedTransfer {
  hash: string;
  /** Token contract, or null for native HYPE. */
  token: string | null;
  symbol: string;
  decimals: number;
  /** Raw amount in the token's smallest unit, as a decimal string. */
  amount: string;
  from: string;
  to: string;
  blockNumber: number;
  chainId: 99901;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HASH = /^0x[0-9a-fA-F]{64}$/;
const topicAddr = (t: string | undefined) => (t && t.length === 66 ? `0x${t.slice(26)}`.toLowerCase() : null);

interface RawReceipt {
  status: string;
  blockNumber: string;
  from: string;
  to: string | null;
  logs: { address: string; topics: string[]; data: string }[];
}
interface RawTx {
  from: string;
  to: string | null;
  value: string;
  blockNumber: string | null;
}

export type TransferCheck = { ok: true; transfer: VerifiedTransfer } | { ok: false; status: number; error: string };

async function readMeta(env: Env, token: string): Promise<{ symbol: string; decimals: number }> {
  const read = async <T>(fn: "symbol" | "decimals"): Promise<T | null> => {
    try {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: fn });
      const raw = await call<Hex>(env, "eth_call", [{ to: token, data }, "latest"]);
      return decodeFunctionResult({ abi: erc20Abi, functionName: fn, data: raw }) as T;
    } catch {
      return null;
    }
  };
  const [symbol, decimals] = await Promise.all([read<string>("symbol"), read<number>("decimals")]);
  return {
    symbol: (symbol ?? "TOKEN").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 16) || "TOKEN",
    decimals: typeof decimals === "number" && decimals >= 0 && decimals <= 36 ? decimals : 18,
  };
}

/**
 * Reads the transaction and its receipt and returns what it actually moved to `recipient`: native HYPE sent straight
 * to the wallet, or an ERC-20 Transfer from the sender to the wallet (`token` picks which one when given).
 */
export async function verifyTransfer(env: Env, hash: string, recipient: string, token: string | null): Promise<TransferCheck> {
  if (!HASH.test(hash)) return { ok: false, status: 400, error: "That is not a transaction hash." };
  const to = recipient.toLowerCase();
  let tx: RawTx | null;
  let receipt: RawReceipt | null;
  try {
    [tx, receipt] = await Promise.all([
      call<RawTx | null>(env, "eth_getTransactionByHash", [hash]),
      call<RawReceipt | null>(env, "eth_getTransactionReceipt", [hash]),
    ]);
  } catch {
    return { ok: false, status: 502, error: "Elysium's RPC did not answer. Try recording the transfer again in a moment." };
  }
  if (!tx) return { ok: false, status: 404, error: "Elysium does not know this transaction." };
  if (!receipt) return { ok: false, status: 409, error: "The transaction has not been mined yet." };
  if (receipt.status !== "0x1") return { ok: false, status: 422, error: "The transaction failed on chain, so nothing was sent." };
  const from = tx.from.toLowerCase();
  const blockNumber = parseInt(receipt.blockNumber, 16);

  if (!token) {
    const value = BigInt(tx.value || "0x0");
    if ((tx.to ?? "").toLowerCase() !== to || value <= 0n) {
      return { ok: false, status: 422, error: "This transaction did not send HYPE to the recipient's linked wallet." };
    }
    return { ok: true, transfer: { hash: hash.toLowerCase(), token: null, symbol: "HYPE", decimals: 18, amount: value.toString(), from, to, blockNumber, chainId: 99901 } };
  }

  const want = token.toLowerCase();
  let amount = 0n;
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== want || log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) continue;
    if (topicAddr(log.topics[1]) !== from || topicAddr(log.topics[2]) !== to) continue;
    try {
      amount += BigInt(log.data.slice(0, 66));
    } catch {
      /* malformed log */
    }
  }
  if (amount <= 0n) return { ok: false, status: 422, error: "This transaction did not move that token to the recipient's linked wallet." };
  const meta = await readMeta(env, want);
  return { ok: true, transfer: { hash: hash.toLowerCase(), token: want, ...meta, amount: amount.toString(), from, to, blockNumber, chainId: 99901 } };
}

/** "1.5 HYPE" from raw units, trimmed to six decimals. */
export function describeTransfer(t: Pick<VerifiedTransfer, "amount" | "decimals" | "symbol">): string {
  const raw = BigInt(t.amount);
  const scale = 10n ** BigInt(t.decimals);
  const frac = (raw % scale).toString().padStart(t.decimals, "0").slice(0, 6).replace(/0+$/, "");
  return `${raw / scale}${frac ? `.${frac}` : ""} ${t.symbol}`;
}
