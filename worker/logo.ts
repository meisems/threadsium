// GET /api/logo/<token address>: automatic multi-source token logo lookup on Elysium 99901.
// Sources:
//   0. CURATED official logos (e.g. KNTQ)
//   1. Kleos board (www.thekleos.pro/api/board)
//   2. BOXA token index (boxa.club/api/index/tokens/<addr>)
//   3. ELYXA pairs feed (elyxa.trade/api/pairs?q=<addr>)
//   4. Stockium metadata (stockium.fun/api/meta?tokens=<addr>)
//   5. Contract getters (tokenURI/contractURI/metadataURI + logo/image/icon) via Multicall3
import { parseAbi } from "viem";
import type { Env } from "./env.ts";
import { cacheGet, cachePut } from "./kvcache.ts";
import { multicall } from "./rpc.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UA = "Threadsium/1.0 (+logo lookup)";
const LOOKUP_TIMEOUT = 6_000;
const IMAGE_TIMEOUT = 8_000;
const RESIZED_MAX = 300 * 1024;
const ORIGINAL_MAX = 1024 * 1024;
const SVG_MAX = 200 * 1024;
const JSON_MAX = 64 * 1024;
const PX = 112;
const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const CACHE_VERSION = "v1";

export const CURATED: Record<string, string> = {
  "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0": "https://kinetiq.xyz/assets/brand/tokens/kntq.svg",
};

export function ipfsToHttps(raw: string): string {
  const s = raw.trim();
  return s.startsWith("ipfs://") ? IPFS_GATEWAY + s.slice(7).replace(/^ipfs\//, "") : s;
}

export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let u: URL;
  try {
    u = new URL(ipfsToHttps(raw));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h)) return null;
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(h)) return null;
  return u.toString();
}

export function rasterType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const RASTER_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

export function safeSvg(b: Uint8Array): boolean {
  if (b.length > SVG_MAX) return false;
  const s = new TextDecoder().decode(b);
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s)) return false;
  if (/<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|@import|javascript:/i.test(s)) return false;
  if (/data:(?!image\/(png|jpe?g|gif|webp);base64,)/i.test(s)) return false;
  if (/\son[a-z]+\s*=/i.test(s)) return false;
  for (const m of s.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
    if (!m[1].startsWith("#") && !RASTER_DATA.test(m[1])) return false;
  }
  for (const m of s.matchAll(/url\(\s*["']?([^"')]*)/gi)) {
    if (!m[1].startsWith("#")) return false;
  }
  return true;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getBytes(url: string, max: number, accept = "image/webp,image/png,image/jpeg,image/gif;q=0.9"): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { accept, "user-agent": UA }, signal: AbortSignal.timeout(IMAGE_TIMEOUT) });
    if (res.status !== 200 || !res.body) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > max) {
      await res.body.cancel();
      return null;
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

let kleosBoard: { at: number; images: Map<string, string> } | null = null;
async function kleosImage(addr: string): Promise<string | null> {
  if (!kleosBoard || Date.now() - kleosBoard.at > 300_000) {
    const body = (await getJson("https://www.thekleos.pro/api/board")) as Record<string, { address?: unknown; image?: unknown }> | unknown[];
    const images = new Map<string, string>();
    for (const item of Object.values(body ?? {}) as { address?: unknown; image?: unknown }[]) {
      if (typeof item?.address === "string" && typeof item.image === "string") images.set(item.address.toLowerCase(), item.image);
    }
    kleosBoard = { at: Date.now(), images };
  }
  return kleosBoard.images.get(addr) ?? null;
}

async function boxaImage(addr: string): Promise<string | null> {
  const body = (await getJson(`https://boxa.club/api/index/tokens/${addr}`)) as { token?: { address?: unknown; image?: unknown } };
  const t = body?.token;
  return t && String(t.address ?? "").toLowerCase() === addr && typeof t.image === "string" ? t.image : null;
}

async function elyxaImage(addr: string): Promise<string | null> {
  const body = (await getJson(`https://elyxa.trade/api/pairs?launchpad=All&sort=age&q=${addr}&limit=10&offset=0&window=86400`)) as {
    pairs?: Record<string, unknown>[];
  };
  for (const p of body?.pairs ?? []) {
    if (typeof p.token === "string" && p.token.toLowerCase() === addr && typeof p.image === "string") return p.image;
  }
  return null;
}

async function stockiumImage(addr: string): Promise<string | null> {
  const body = (await getJson(`https://stockium.fun/api/meta?tokens=${addr}`)) as { meta?: Record<string, { image?: unknown }> };
  const image = body?.meta?.[addr]?.image;
  return typeof image === "string" ? image : null;
}

const JSON_GETTERS = ["tokenURI", "contractURI", "metadataURI", "metadataUri", "uri", "metadata"];
const IMAGE_GETTERS = ["logo", "logoURI", "logoUrl", "image", "imageURI", "imageUri", "imageUrl", "icon"];
const META_ABI = parseAbi([...JSON_GETTERS, ...IMAGE_GETTERS].map((f) => `function ${f}() view returns (string)`));

async function imageFromJson(uri: string): Promise<string | null> {
  let doc: unknown;
  const s = uri.trim();
  if (s.startsWith("data:application/json")) {
    const comma = s.indexOf(",");
    const head = s.slice(0, comma);
    const data = s.slice(comma + 1);
    try {
      doc = JSON.parse(head.includes(";base64") ? atob(data) : decodeURIComponent(data));
    } catch {
      return null;
    }
  } else {
    const url = safeImageUrl(s);
    if (!url) return null;
    const bytes = await getBytes(url, JSON_MAX, "application/json");
    if (!bytes) return null;
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }
  const d = doc as Record<string, unknown>;
  const img = [d?.image, d?.logo, d?.icon, d?.image_url, d?.logoURI].find((v) => typeof v === "string");
  return typeof img === "string" ? img : null;
}

async function onchainImages(env: Env, addr: string): Promise<string[]> {
  const fns = [...JSON_GETTERS, ...IMAGE_GETTERS];
  const answers = await multicall<string>(env, fns.map((functionName) => ({ target: addr, abi: META_ABI, functionName })));
  const out: string[] = [];
  for (let i = 0; i < fns.length; i++) {
    const v = answers[i];
    if (typeof v !== "string" || !v.trim()) continue;
    if (i < JSON_GETTERS.length) {
      const img = await imageFromJson(v).catch(() => null);
      if (img) out.push(img);
    } else out.push(v);
  }
  return out;
}

const resizer = (src: string) => `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=${PX}&h=${PX}&fit=cover&output=webp&q=82`;

function imageResponse(bytes: Uint8Array, type: string, maxAge: number): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": type,
      "cache-control": `public, max-age=${maxAge}`,
      "content-security-policy": type === "image/svg+xml" ? "default-src 'none'; style-src 'unsafe-inline'" : "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

async function serve(src: string, allowSvg: boolean): Promise<Response | null> {
  const small = await getBytes(resizer(src), RESIZED_MAX);
  const smallType = small && rasterType(small);
  if (small && smallType) return imageResponse(small, smallType, 86_400);
  const full = await getBytes(src, ORIGINAL_MAX, allowSvg ? "image/svg+xml,image/*;q=0.9" : undefined);
  if (!full) return null;
  const fullType = rasterType(full);
  if (fullType) return imageResponse(full, fullType, 3_600);
  if (allowSvg && safeSvg(full)) return imageResponse(full, "image/svg+xml", 86_400);
  return null;
}

async function resolve(env: Env, addr: string): Promise<Response> {
  const curated = CURATED[addr];
  if (curated) {
    const res = await serve(curated, true);
    if (res) return res;
  }
  let failed = false;
  const soft = <T,>(p: Promise<T>, empty: T) =>
    p.catch(() => {
      failed = true;
      return empty;
    });
  const found = await Promise.all([
    soft(kleosImage(addr), null),
    soft(boxaImage(addr), null),
    soft(elyxaImage(addr), null),
    soft(stockiumImage(addr), null),
    soft(onchainImages(env, addr), [] as string[]),
  ]);
  const tried = new Set<string>();
  for (const raw of found.flat()) {
    const src = safeImageUrl(raw);
    if (!src || tried.has(src)) continue;
    tried.add(src);
    const res = await serve(src, false);
    if (res) return res;
    failed = true;
  }
  return new Response(null, { status: 204, headers: { "cache-control": `public, max-age=${failed ? 60 : 600}` } });
}

const inflight = new Map<string, Promise<Response>>();

export async function handleLogo(req: Request, env: Env, ctx: ExecutionContext, address: string): Promise<Response> {
  const addr = address.toLowerCase();
  if (!ADDRESS.test(addr)) {
    return new Response(JSON.stringify({ error: "not a token address" }), {
      status: 400,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const key = `${new URL(req.url).origin}/__logo/${CACHE_VERSION}/${addr}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;
  let p = inflight.get(addr);
  if (!p) {
    p = (async () => {
      try {
        const res = await resolve(env, addr);
        cachePut(env, ctx, key, res, res.status === 200 ? 7 * 86_400 : undefined);
        return res;
      } finally {
        inflight.delete(addr);
      }
    })();
    inflight.set(addr, p);
  }
  return (await p).clone();
}
