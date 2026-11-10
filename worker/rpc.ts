// Server-side Elysium 99901 RPC client with automatic upstream failover.
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Hex } from "viem";
import { CHAIN } from "../src/config/chain.ts";
import type { Env } from "./env.ts";

export const DEFAULT_UPSTREAMS = [
  "https://rpc.elysium.kinetiq.xyz",
  "https://rpc-live.boxa.club",
  "https://rpc.elyscan.live",
  "https://rpc.agoradex.app",
];

export function upstreams(env: Env): string[] {
  const list = (env.RPC_FALLBACKS || DEFAULT_UPSTREAMS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("https://"));
  return env.RPC_URL ? [env.RPC_URL, ...list] : list;
}

async function post(url: string, body: string): Promise<{ status: number; text: string } | string> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(9_000),
    });
    if (res.status === 429 || res.status >= 500) return `HTTP ${res.status}`;
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return (e as Error).message;
  }
}

const UPSTREAM_LIMIT = /log range|range is|exceeds|too (many|large|big)|limit|batch|rate|unavailable|try again/i;

function limitRefusal(text: string): boolean {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } } | { error?: { message?: string } }[];
    return (Array.isArray(j) ? j : [j]).some((x) => !!x?.error && UPSTREAM_LIMIT.test(String(x.error.message ?? "")));
  } catch {
    return false;
  }
}

export async function forward(env: Env, body: string): Promise<{ status: number; text: string }> {
  let last = "no upstream";
  let refused: { status: number; text: string } | null = null;
  for (const url of upstreams(env)) {
    const r = await post(url, body);
    if (typeof r === "string") {
      last = r;
      continue;
    }
    if (r.status === 200 && limitRefusal(r.text)) {
      refused ??= r;
      continue;
    }
    return r;
  }
  return (
    refused ?? {
      status: 502,
      text: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `All Elysium upstreams failed (${last})` } }),
    }
  );
}

let id = 1;
export async function call<T = unknown>(env: Env, method: string, params: unknown[]): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: id++, method, params });
  let first: string | null = null;
  for (const url of upstreams(env)) {
    const r = await post(url, body);
    if (typeof r === "string") {
      first ??= r;
      continue;
    }
    try {
      const j = JSON.parse(r.text) as { result?: T; error?: { message: string } };
      if (!j.error) return j.result as T;
      first ??= j.error.message;
    } catch {
      first ??= `HTTP ${r.status}, invalid JSON`;
    }
  }
  throw new Error(first ?? "no upstream");
}

const MC = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);

export interface WCall {
  target: string;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export async function multicall<T = unknown>(env: Env, calls: WCall[]): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += 120) {
    const chunk = calls.slice(i, i + 120);
    const data = encodeFunctionData({
      abi: MC,
      functionName: "aggregate3",
      args: [
        chunk.map((c) => ({
          target: c.target as Hex,
          allowFailure: true,
          callData: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args ?? [] } as never),
        })),
      ],
    });
    const raw = await call<Hex>(env, "eth_call", [{ to: CHAIN.multicall3, data }, "latest"]);
    const res = decodeFunctionResult({ abi: MC, functionName: "aggregate3", data: raw }) as readonly {
      success: boolean;
      returnData: Hex;
    }[];
    res.forEach((r, k) => {
      if (!r.success || r.returnData === "0x") return out.push(null);
      try {
        const c = chunk[k];
        out.push(decodeFunctionResult({ abi: c.abi, functionName: c.functionName, data: r.returnData } as never) as T);
      } catch {
        out.push(null);
      }
    });
  }
  return out;
}
