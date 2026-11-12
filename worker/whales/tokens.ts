// Token metadata (symbol, name, decimals) in batches through Multicall3's aggregate3 with allowFailure, so one
// reverting token never spoils the batch. Handles string and legacy bytes32 symbols/names.

import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, hexToString, parseAbi } from "viem";
import type { Rpc } from "./client.ts";
import type { Address, Hex, TokenMeta } from "./types.ts";

const MULTICALL = parseAbi(["struct Call3 { address target; bool allowFailure; bytes callData; }", "struct Result { bool success; bytes returnData; }", "function aggregate3(Call3[] calls) payable returns (Result[] returnData)"]);
const SELECTORS = { symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567" } as const;

/** An ABI-encoded string, a bytes32 string, or null. Control characters are removed and length is capped. */
export function decodeText(data: Hex): string | null {
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) || null;
  if (!data || data === "0x") return null;
  if (data.length >= 2 + 64 * 3) {
    try { return clean(decodeAbiParameters([{ type: "string" }], data)[0]); } catch { /* fall through to bytes32 */ }
  }
  if (data.length === 66) {
    try { return clean(hexToString(data, { size: 32 })); } catch { return null; }
  }
  return null;
}

export function decodeDecimals(data: Hex): number | null {
  if (!/^0x[0-9a-fA-F]{64}/.test(data)) return null;
  const value = BigInt(data.slice(0, 66));
  return value <= 255n ? Number(value) : null;
}

export async function fetchTokenMeta(rpc: Rpc, multicall3: Address, tokens: Address[]): Promise<TokenMeta[]> {
  if (!tokens.length) return [];
  const calls = tokens.flatMap((target) => [SELECTORS.symbol, SELECTORS.name, SELECTORS.decimals].map((callData) => ({ target, allowFailure: true, callData: callData as Hex })));
  const data = encodeFunctionData({ abi: MULTICALL, functionName: "aggregate3", args: [calls] });
  const raw = await rpc.call<Hex>("eth_call", [{ to: multicall3, data }, "latest"]);
  const results = decodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", data: raw }) as readonly { success: boolean; returnData: Hex }[];
  return tokens.map((address, index) => {
    const [symbol, name, decimals] = results.slice(index * 3, index * 3 + 3);
    return {
      address,
      symbol: symbol?.success ? decodeText(symbol.returnData) : null,
      name: name?.success ? decodeText(name.returnData) : null,
      decimals: decimals?.success ? decodeDecimals(decimals.returnData) : null,
    };
  });
}
