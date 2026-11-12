// Read-only Elysium 99901 JSON-RPC proxy (/api/rpc) with strict method allowlist, origin validation, and log range bounds (R12).
import { V4_INITIALIZE_TOPIC, V4_MANAGERS } from "../src/config/v4.ts";
import { V3_POOL_CREATED_TOPIC, V3_VENUES } from "../src/config/venues.ts";
import type { Env } from "./env.ts";
import { forward } from "./rpc.ts";

const V4_LOG_ADDRESSES = new Set<string>(V4_MANAGERS.map((m) => m.poolManager.toLowerCase()));
const V3_FACTORY_ADDRESSES = new Set<string>(V3_VENUES.map((v) => v.factory.toLowerCase()));

function narrowPoolDiscoveryOrV4Query(f: Record<string, unknown>): boolean {
  const addrs = Array.isArray(f.address) ? f.address : [f.address];
  if (!addrs.length || addrs.length > 10) return false;
  const topics = Array.isArray(f.topics) ? f.topics : [];
  const t0 = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";

  if (addrs.every((a) => typeof a === "string" && V3_FACTORY_ADDRESSES.has(a.toLowerCase()))) {
    return t0 === V3_POOL_CREATED_TOPIC.toLowerCase();
  }
  if (addrs.every((a) => typeof a === "string" && V4_LOG_ADDRESSES.has(a.toLowerCase()))) {
    if (t0 === V4_INITIALIZE_TOPIC.toLowerCase()) return true;
    return Boolean(t0) && topics.slice(1).some((t) => typeof t === "string" || Array.isArray(t));
  }
  return false;
}

const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
  "eth_getLogs",
  "eth_gasPrice",
  "net_version",
]);

const MAX_BODY = 96 * 1024;
const MAX_BATCH = 20;
const MAX_LOG_RANGE = 100_000;

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function originAllowed(req: Request, env: Env): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = new URL(req.url).host;
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
    // Local development: Vite on localhost:5173 proxies to wrangler on 127.0.0.1:8845, so the loopback names differ.
    const loopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    if (loopback(o.hostname)) {
      return loopback(new URL(req.url).hostname);
    }
    const extra = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return extra.includes(o.origin);
  } catch {
    return false;
  }
}

function checkOne(r: unknown): string | null {
  if (!r || typeof r !== "object") return "invalid request";
  const { method, params } = r as { method?: unknown; params?: unknown };
  if (typeof method !== "string" || !ALLOWED.has(method)) return `method not allowed: ${String(method).slice(0, 40)}`;
  if (params !== undefined && !Array.isArray(params)) return "params must be an array";
  if (method === "eth_getLogs") {
    const f = (params as Record<string, unknown>[])?.[0] ?? {};
    if (!f.address) return "eth_getLogs requires an address";
    const from = typeof f.fromBlock === "string" && f.fromBlock.startsWith("0x") ? parseInt(f.fromBlock, 16) : null;
    const to = typeof f.toBlock === "string" && f.toBlock.startsWith("0x") ? parseInt(f.toBlock, 16) : null;
    if (from === null) return "eth_getLogs requires a numeric fromBlock";
    if (narrowPoolDiscoveryOrV4Query(f)) return null;
    if (f.toBlock === "latest") return null;
    if (to === null) return "eth_getLogs requires a numeric toBlock";
    if (to - from > MAX_LOG_RANGE) return `eth_getLogs range exceeds ${MAX_LOG_RANGE} blocks`;
  }
  return null;
}

export async function handleRpc(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return err(405, "POST only");
  if (!originAllowed(req, env)) return err(403, "Cross-origin RPC requests are not permitted.");
  const len = Number(req.headers.get("content-length") || "0");
  if (len > MAX_BODY) return err(413, "request too large");
  const text = await req.text();
  if (text.length > MAX_BODY) return err(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return err(400, "invalid JSON");
  }
  const items = Array.isArray(body) ? body : [body];
  if (!items.length || items.length > MAX_BATCH) return err(400, `batch must contain 1-${MAX_BATCH} calls`);
  for (const it of items) {
    const problem = checkOne(it);
    if (problem) return err(400, problem);
  }
  // Swap reads (?for=swap) try the keyed Alchemy endpoint first, then the launchpad nodes. The key stays on the server.
  const forSwap = new URL(req.url).searchParams.get("for") === "swap";
  const res = await forward(forSwap && env.ALCHEMY_RPC_URL ? { ...env, RPC_URL: env.ALCHEMY_RPC_URL } : env, text);
  return new Response(res.text, {
    status: res.status === 200 ? 200 : 502,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
