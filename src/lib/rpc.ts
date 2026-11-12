import { ELYSIUM_CHAIN, MULTICALL3_ADDRESS } from "../config/chain";

// Threadsium's /api/rpc (which reads the launchpads' nodes), then the launchpad nodes that allow browsers directly.
// Public community RPCs are not used from the browser; the Worker uses them only for Whale watch scans.
const ENDPOINTS = ["/api/rpc", ...ELYSIUM_CHAIN.launchpadRpcs];
/** Swaps: /api/rpc?for=swap (the Worker's keyed Alchemy endpoint, then the launchpad nodes), then the launchpad nodes. */
export const SWAP_ENDPOINTS = ["/api/rpc?for=swap", ...ELYSIUM_CHAIN.launchpadRpcs];

let reqId = 1;

export async function rpcRequest<T = any>(
  method: string,
  params: unknown[] = [],
  endpoints: readonly string[] = ENDPOINTS
): Promise<T> {
  let lastErr: unknown = null;
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6500);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: reqId++,
          method,
          params,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = (await res.json()) as { result?: T; error?: { message?: string } };
      if (data.error) {
        lastErr = new Error(data.error.message || "RPC error");
        continue;
      }
      if (data.result !== undefined) return data.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`RPC ${method} failed`);
}

/** An eth_call that reverted: the node answered, so trying another endpoint would only repeat the revert. */
export class RpcRevert extends Error {
  data: string;
  constructor(message: string, data: string) {
    super(message);
    this.data = data;
  }
}

const REVERT = /revert|execution|invalid opcode|out of gas/i;

/**
 * Like rpcRequest, but a revert (or any execution error) is final instead of being retried on every endpoint.
 * Used for quotes and pool probes, where most calls are expected to revert for tokens a venue does not trade.
 */
export async function rpcCall<T = string>(method: string, params: unknown[] = [], endpoints: readonly string[] = ENDPOINTS): Promise<T> {
  let lastErr: unknown = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: reqId++, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown } };
      if (data.error) {
        const message = data.error.message || "RPC error";
        const raw = typeof data.error.data === "string" ? data.error.data : "";
        if (REVERT.test(message) || raw.startsWith("0x")) throw new RpcRevert(message, raw);
        lastErr = new Error(message);
        continue;
      }
      if (data.result !== undefined) return data.result;
    } catch (err) {
      if (err instanceof RpcRevert) throw err;
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`RPC ${method} failed`);
}

export async function fetchLatestBlock(): Promise<{
  blockNumber: number;
  timestamp: number;
}> {
  const hexBlock = await rpcRequest<string>("eth_blockNumber", []);
  const blockNumber = parseInt(hexBlock, 16);
  return {
    blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export type HolderTier = "whale" | "holder" | "spectator";

export interface WalletHoldingBadge {
  tier: HolderTier;
  balanceFormatted: number;
  pctOfSupply: number;
}

function encodeBalanceOf(wallet: string): string {
  return `0x70a08231000000000000000000000000${wallet.toLowerCase().replace(/^0x/, "")}`;
}

export async function fetchWalletTokenTier(
  tokenAddress: string,
  walletAddress: string | null | undefined,
  decimals = 18
): Promise<WalletHoldingBadge | null> {
  if (
    !walletAddress ||
    !/^0x[a-fA-F0-9]{40}$/.test(walletAddress) ||
    !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)
  ) {
    return null;
  }
  try {
    const [balHex, supplyHex] = await Promise.all([
      rpcRequest<string>("eth_call", [
        { to: tokenAddress, data: encodeBalanceOf(walletAddress) },
        "latest",
      ]),
      rpcRequest<string>("eth_call", [
        { to: tokenAddress, data: "0x18160ddd" },
        "latest",
      ]),
    ]);
    const bal = balHex && balHex !== "0x" ? BigInt(balHex) : 0n;
    const supply = supplyHex && supplyHex !== "0x" ? BigInt(supplyHex) : 0n;
    const scale = 10 ** Math.min(18, Math.max(0, decimals));
    const balanceFormatted = Number(bal) / scale;
    const supplyFormatted = supply > 0n ? Number(supply) / scale : 0;
    const pctOfSupply =
      supplyFormatted > 0 ? (balanceFormatted / supplyFormatted) * 100 : 0;

    if (bal <= 0n) {
      return { tier: "spectator", balanceFormatted: 0, pctOfSupply: 0 };
    }
    if (pctOfSupply >= 1.0) {
      return { tier: "whale", balanceFormatted, pctOfSupply };
    }
    return { tier: "holder", balanceFormatted, pctOfSupply };
  } catch {
    return null;
  }
}

export { MULTICALL3_ADDRESS };
