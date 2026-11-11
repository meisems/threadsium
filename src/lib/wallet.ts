// The visitor's own browser wallet (EIP-1193, window.ethereum). Threadsium never holds or asks for keys:
// every transaction here is built in the page and signed in the wallet after the visitor reviews it.
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { CHAIN } from "../config/chain.ts";
import { rpcCall, rpcRequest } from "./rpc.ts";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
}

export const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function walletProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) as Eip1193 | null;
}

/** A readable sentence for a wallet error; code 4001 is the visitor pressing Reject. */
export function walletError(e: unknown): string {
  const err = e as { code?: number; message?: string; shortMessage?: string };
  if (err?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  if (err?.code === -32002) return "Your wallet already has a request open. Finish or close it there first.";
  const msg = (err?.shortMessage || err?.message || "").replace(/0x[0-9a-f]{40,}/gi, "").trim();
  if (/insufficient funds/i.test(msg)) return "Your wallet does not hold enough HYPE for this amount plus gas.";
  return msg.slice(0, 180) || "The wallet request failed.";
}

/** Addresses the wallet already shares with this site, without opening a prompt. */
export async function connectedAccount(): Promise<string | null> {
  const eth = walletProvider();
  if (!eth) return null;
  try {
    const list = (await eth.request({ method: "eth_accounts" })) as string[];
    return list?.[0] && ADDRESS.test(list[0]) ? list[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function requestAccount(): Promise<string> {
  const eth = walletProvider();
  if (!eth) throw new Error("No browser wallet was found. Install or unlock one (MetaMask, Rabby, OKX…) and reload.");
  const list = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const addr = list?.[0];
  if (!addr || !ADDRESS.test(addr)) throw new Error("The wallet did not share an address.");
  return addr.toLowerCase();
}

/** Puts the wallet on Elysium 99901, adding the network first if the wallet has never seen it. */
export async function ensureElysium(): Promise<void> {
  const eth = walletProvider();
  if (!eth) throw new Error("No browser wallet was found.");
  const current = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (current === CHAIN.hexId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.hexId }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CHAIN.hexId,
          chainName: `Elysium ${CHAIN.id}`,
          nativeCurrency: CHAIN.native,
          rpcUrls: [CHAIN.walletRpc, ...CHAIN.walletRpcBackups],
          blockExplorerUrls: [CHAIN.explorer],
        },
      ],
    });
  }
  const after = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (after !== CHAIN.hexId) throw new Error(`Switch your wallet to Elysium (chain ${CHAIN.id}) and try again.`);
}

export interface TxRequest {
  to: string;
  data?: string;
  value?: bigint;
}

/** Sends one transaction from `from` through the wallet; the wallet estimates gas and asks the visitor to sign. */
export async function sendTransaction(from: string, tx: TxRequest): Promise<Hex> {
  const eth = walletProvider();
  if (!eth) throw new Error("No browser wallet was found.");
  await ensureElysium();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: tx.to,
        data: tx.data ?? "0x",
        value: `0x${(tx.value ?? 0n).toString(16)}`,
      },
    ],
  })) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

export interface Receipt {
  status: "success" | "reverted";
  blockNumber: number;
}

/** Waits for a transaction to be mined (Elysium makes about 14 blocks a second, so this is usually instant). */
export async function waitForReceipt(hash: string, timeoutMs = 90_000): Promise<Receipt> {
  const until = Date.now() + timeoutMs;
  let delay = 600;
  while (Date.now() < until) {
    const r = await rpcRequest<{ status?: string; blockNumber?: string } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r && r.blockNumber) {
      return { status: r.status === "0x1" ? "success" : "reverted", blockNumber: parseInt(r.blockNumber, 16) };
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(3000, Math.round(delay * 1.4));
  }
  throw new Error("The transaction was sent but has not been mined yet. Check it on the explorer.");
}

/* ───────── reads ───────── */

const word = (hex: string | null | undefined) => (hex && /^0x[0-9a-fA-F]{64}/.test(hex) ? BigInt(hex.slice(0, 66)) : null);

export async function nativeBalance(owner: string): Promise<bigint | null> {
  const hex = await rpcRequest<string>("eth_getBalance", [owner, "latest"]).catch(() => null);
  return hex ? BigInt(hex) : null;
}

export async function tokenBalance(token: string, owner: string): Promise<bigint | null> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner as Hex] });
  return word(await rpcCall<string>("eth_call", [{ to: token, data }, "latest"]).catch(() => null));
}

export async function balanceOf(asset: string, owner: string): Promise<bigint | null> {
  return asset === NATIVE_ADDRESS ? nativeBalance(owner) : tokenBalance(asset, owner);
}

export async function allowance(token: string, owner: string, spender: string): Promise<bigint | null> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner as Hex, spender as Hex] });
  return word(await rpcCall<string>("eth_call", [{ to: token, data }, "latest"]).catch(() => null));
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

const META = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)"]);
const infoCache = new Map<string, Promise<TokenInfo | null>>();

function decodeString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;
  try {
    const body = hex.slice(2);
    if (body.length >= 128) {
      const len = Number(BigInt(`0x${body.slice(64, 128)}`));
      const bytes = body.slice(128, 128 + len * 2);
      return new TextDecoder().decode(Uint8Array.from(bytes.match(/../g) ?? [], (b) => parseInt(b, 16))).replace(/[^\x20-\x7e]/g, "").trim() || null;
    }
    // bytes32 symbol
    return new TextDecoder().decode(Uint8Array.from(body.match(/../g) ?? [], (b) => parseInt(b, 16))).replace(/[^\x20-\x7e]/g, "").trim() || null;
  } catch {
    return null;
  }
}

/** Symbol, name and decimals read from the token contract itself (cached for the page's life). */
export function tokenInfo(address: string): Promise<TokenInfo | null> {
  const key = address.toLowerCase();
  if (key === NATIVE_ADDRESS) return Promise.resolve({ address: key, symbol: "HYPE", name: "HYPE", decimals: 18 });
  let hit = infoCache.get(key);
  if (!hit) {
    const read = (fn: "symbol" | "name" | "decimals") =>
      rpcCall<string>("eth_call", [{ to: key, data: encodeFunctionData({ abi: META, functionName: fn }) }, "latest"]).catch(() => null);
    hit = Promise.all([read("symbol"), read("name"), read("decimals")]).then(([s, n, d]) => {
      const dec = word(d);
      if (dec === null || dec > 36n) return null;
      return { address: key, symbol: decodeString(s) ?? "TOKEN", name: decodeString(n) ?? "", decimals: Number(dec) };
    });
    infoCache.set(key, hit);
    hit.then((v) => {
      if (!v) infoCache.delete(key);
    });
  }
  return hit;
}

/* ───────── amounts ───────── */

/** "1.5" → 1500000000000000000n for 18 decimals; null when the text is not a positive amount. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const m = /^\s*(\d{0,30})(?:\.(\d*))?\s*$/.exec(text.replace(/,/g, ""));
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] ?? "").slice(0, decimals);
  const raw = BigInt((m[1] || "0") + frac.padEnd(decimals, "0"));
  return raw > 0n ? raw : null;
}

/** Raw units to a short decimal string (up to `places` significant decimals). */
export function formatAmount(raw: bigint, decimals: number, places = 6): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = v / scale;
  let frac = (v % scale).toString().padStart(decimals, "0");
  if (whole > 0n) frac = frac.slice(0, Math.max(0, places - Math.min(places, whole.toString().length - 1)));
  else {
    const lead = frac.match(/^0*/)?.[0].length ?? 0;
    frac = frac.slice(0, lead + places);
  }
  frac = frac.replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${frac ? `.${frac}` : ""}`;
}

/** Plain decimal string without grouping, for putting a balance back into an input. */
export function amountInput(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / scale}${frac ? `.${frac}` : ""}`;
}

export function transferData(to: string, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as Hex, amount] });
}

export function approveData(spender: string, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as Hex, amount] });
}
