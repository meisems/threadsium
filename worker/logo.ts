// Fast-Track Token & Launchpad Logo Pipeline on Elysium 99901.
// GET /api/logo/<token address>
// GET /api/launchpad-logo/<launchpad id>
//
// Fast-Track Architecture:
//   0. Isolate in-memory byte cache (0ms response on warm isolate)
//   1. CURATED official logos & shared rememberedLogos map populated by /api/tokens, /api/launchpads, and Kleos board (skips all index lookups!)
//   2. First-win race (Promise.any) across Montra, Kleos board, BOXA, ELYXA, and Stockium with tight 2.4s timeout (never waits for slow stragglers)
//   3. On-chain contract getters (tokenURI/contractURI/logo/image) via Multicall3 + launchpad token fallback
import { parseAbi } from "viem";
import type { Env } from "./env.ts";
import { cacheGet, cachePut } from "./kvcache.ts";
import { multicall } from "./rpc.ts";
import {
  iconCandidates,
  launchpadById,
  launchpadTokenOf,
} from "../src/config/launchpads.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const UA = "Threadsium/1.0 (+logo lookup)";
const FAST_LOOKUP_TIMEOUT = 2_400;
const IMAGE_TIMEOUT = 4_500;
const RESIZED_MAX = 300 * 1024;
const ORIGINAL_MAX = 1024 * 1024;
const SVG_MAX = 200 * 1024;
const JSON_MAX = 64 * 1024;
const PX = 112;
const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";
const CACHE_VERSION = "v2";

export const CURATED: Record<string, string> = {
  "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0":
    "https://kinetiq.xyz/assets/brand/tokens/kntq.svg",
};

// Shared isolate-level URL and byte caches for zero-latency logo serving
const rememberedLogos = new Map<string, string>();
const rememberedLaunchpadLogos = new Map<string, string>();
const memoryLogoBytes = new Map<
  string,
  { bytes: Uint8Array; type: string; maxAge: number; at: number }
>();
const MAX_MEMORY_LOGOS = 180;

function putMemoryBytes(
  key: string,
  bytes: Uint8Array,
  type: string,
  maxAge: number
): void {
  if (memoryLogoBytes.size >= MAX_MEMORY_LOGOS) {
    const oldest = memoryLogoBytes.keys().next().value;
    if (oldest) memoryLogoBytes.delete(oldest);
  }
  memoryLogoBytes.set(key, { bytes, type, maxAge, at: Date.now() });
}

export function rememberLogoUrl(address: string, rawUrl: unknown): void {
  if (typeof address !== "string") return;
  const addr = address.trim().toLowerCase();
  if (!ADDRESS.test(addr)) return;
  const safe = safeImageUrl(rawUrl);
  if (!safe) return;
  rememberedLogos.set(addr, safe);
}

export function getRememberedLogoUrl(address: string): string | null {
  const addr = address.trim().toLowerCase();
  return CURATED[addr] ?? rememberedLogos.get(addr) ?? null;
}

export function rememberLaunchpadLogoUrl(id: string, rawUrl: unknown): void {
  const safe = safeImageUrl(rawUrl);
  if (!safe) return;
  rememberedLaunchpadLogos.set(id.trim().toLowerCase(), safe);
}

export function ipfsToHttps(raw: string): string {
  const s = raw.trim();
  return s.startsWith("ipfs://")
    ? IPFS_GATEWAY + s.slice(7).replace(/^ipfs\//, "")
    : s;
}

export function safeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let u: URL;
  try {
    u = new URL(ipfsToHttps(raw));
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h)) return null;
  if (
    h === "localhost" ||
    /\.(localhost|local|internal|lan|home|arpa)$/.test(h) ||
    h.endsWith("elyspump.com")
  )
    return null;
  return u.toString();
}

export function rasterType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return "image/gif";
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

const RASTER_DATA =
  /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

export function safeSvg(b: Uint8Array): boolean {
  if (b.length > SVG_MAX) return false;
  const s = new TextDecoder().decode(b);
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(s)) return false;
  if (
    /<script|<foreignobject|<iframe|<embed|<object|<!entity|<!doctype|@import|javascript:/i.test(
      s
    )
  )
    return false;
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

async function getJson(
  url: string,
  timeoutMs = FAST_LOOKUP_TIMEOUT
): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getBytes(
  url: string,
  max: number,
  accept = "image/webp,image/png,image/jpeg,image/gif;q=0.9",
  timeoutMs = IMAGE_TIMEOUT
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, {
      headers: { accept, "user-agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
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
let kleosBoardInflight: Promise<Map<string, string>> | null = null;

async function loadKleosBoard(): Promise<Map<string, string>> {
  if (kleosBoard && Date.now() - kleosBoard.at <= 300_000) {
    return kleosBoard.images;
  }
  if (!kleosBoardInflight) {
    kleosBoardInflight = (async () => {
      try {
        const body = (await getJson("https://www.thekleos.pro/api/board")) as
          | Record<string, { address?: unknown; image?: unknown }>
          | unknown[];
        const images = new Map<string, string>();
        for (const item of Object.values(body ?? {}) as {
          address?: unknown;
          image?: unknown;
        }[]) {
          if (
            typeof item?.address === "string" &&
            typeof item.image === "string"
          ) {
            const addr = item.address.toLowerCase();
            const safe = safeImageUrl(item.image);
            if (safe) {
              images.set(addr, safe);
              rememberedLogos.set(addr, safe);
            }
          }
        }
        kleosBoard = { at: Date.now(), images };
        return images;
      } finally {
        kleosBoardInflight = null;
      }
    })();
  }
  return kleosBoardInflight;
}

async function kleosImage(addr: string): Promise<string | null> {
  if (kleosBoard && Date.now() - kleosBoard.at <= 300_000) {
    return kleosBoard.images.get(addr) ?? null;
  }
  const images = await loadKleosBoard();
  return images.get(addr) ?? null;
}

async function montraImage(addr: string): Promise<string | null> {
  const body = (await getJson(
    `https://api.montramarkets.xyz/api/tokens/${addr}`
  )) as {
    address?: unknown;
    imageUrl?: unknown;
    image?: unknown;
    token?: { address?: unknown; imageUrl?: unknown; image?: unknown };
  };
  const t = body?.token ?? body;
  if (!t || String(t.address ?? "").toLowerCase() !== addr) return null;
  const img =
    typeof t.imageUrl === "string"
      ? t.imageUrl
      : typeof t.image === "string"
        ? t.image
        : null;
  return safeImageUrl(img);
}

async function boxaImage(addr: string): Promise<string | null> {
  const body = (await getJson(
    `https://boxa.club/api/index/tokens/${addr}`
  )) as { token?: { address?: unknown; image?: unknown } };
  const t = body?.token;
  return t &&
    String(t.address ?? "").toLowerCase() === addr &&
    typeof t.image === "string"
    ? safeImageUrl(t.image)
    : null;
}

async function elyxaImage(addr: string): Promise<string | null> {
  const body = (await getJson(
    `https://elyxa.trade/api/pairs?launchpad=All&sort=age&q=${addr}&limit=10&offset=0&window=86400`
  )) as {
    pairs?: Record<string, unknown>[];
  };
  for (const p of body?.pairs ?? []) {
    if (typeof p.token === "string" && typeof p.image === "string") {
      const pAddr = p.token.toLowerCase();
      rememberLogoUrl(pAddr, p.image);
      if (pAddr === addr) return safeImageUrl(p.image);
    }
  }
  return null;
}

async function stockiumImage(addr: string): Promise<string | null> {
  const body = (await getJson(
    `https://stockium.fun/api/meta?tokens=${addr}`
  )) as { meta?: Record<string, { image?: unknown }> };
  const image = body?.meta?.[addr]?.image;
  return typeof image === "string" ? safeImageUrl(image) : null;
}

const JSON_GETTERS = [
  "tokenURI",
  "contractURI",
  "metadataURI",
  "metadataUri",
  "uri",
  "metadata",
];
const IMAGE_GETTERS = [
  "logo",
  "logoURI",
  "logoUrl",
  "image",
  "imageURI",
  "imageUri",
  "imageUrl",
  "icon",
];
const META_ABI = parseAbi(
  [...JSON_GETTERS, ...IMAGE_GETTERS].map(
    (f) => `function ${f}() view returns (string)`
  )
);

async function imageFromJson(uri: string): Promise<string | null> {
  let doc: unknown;
  const s = uri.trim();
  if (s.startsWith("data:application/json")) {
    const comma = s.indexOf(",");
    const head = s.slice(0, comma);
    const data = s.slice(comma + 1);
    try {
      doc = JSON.parse(
        head.includes(";base64") ? atob(data) : decodeURIComponent(data)
      );
    } catch {
      return null;
    }
  } else {
    const url = safeImageUrl(s);
    if (!url) return null;
    const bytes = await getBytes(url, JSON_MAX, "application/json", 3_000);
    if (!bytes) return null;
    try {
      doc = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }
  const d = doc as Record<string, unknown>;
  const img = [d?.image, d?.logo, d?.icon, d?.image_url, d?.logoURI].find(
    (v) => typeof v === "string"
  );
  return typeof img === "string" ? safeImageUrl(img) : null;
}

async function onchainImages(env: Env, addr: string): Promise<string[]> {
  const fns = [...JSON_GETTERS, ...IMAGE_GETTERS];
  const answers = await multicall<string>(
    env,
    fns.map((functionName) => ({ target: addr, abi: META_ABI, functionName }))
  );
  const out: string[] = [];
  for (let i = 0; i < fns.length; i++) {
    const v = answers[i];
    if (typeof v !== "string" || !v.trim()) continue;
    if (i < JSON_GETTERS.length) {
      const img = await imageFromJson(v).catch(() => null);
      if (img) out.push(img);
    } else {
      const safe = safeImageUrl(v);
      if (safe) out.push(safe);
    }
  }
  return out;
}

const resizer = (src: string) =>
  `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=${PX}&h=${PX}&fit=cover&output=webp&q=82`;

function imageResponse(
  bytes: Uint8Array,
  type: string,
  maxAge: number
): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "content-type": type,
      "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=604800`,
      "content-security-policy":
        type === "image/svg+xml"
          ? "default-src 'none'; style-src 'unsafe-inline'"
          : "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

async function fetchValidImageBytes(
  src: string,
  allowSvg: boolean
): Promise<{ bytes: Uint8Array; type: string; maxAge: number } | null> {
  // Race resized WebP vs direct source if SVG is allowed, otherwise try resizer first with fast fallback
  if (allowSvg && /\.svg(\?|$)/i.test(src)) {
    const full = await getBytes(src, ORIGINAL_MAX, "image/svg+xml,image/*;q=0.9");
    if (full) {
      const fullType = rasterType(full);
      if (fullType) return { bytes: full, type: fullType, maxAge: 86_400 };
      if (safeSvg(full))
        return { bytes: full, type: "image/svg+xml", maxAge: 86_400 };
    }
  }

  const small = await getBytes(resizer(src), RESIZED_MAX);
  const smallType = small && rasterType(small);
  if (small && smallType) {
    return { bytes: small, type: smallType, maxAge: 86_400 };
  }

  const full = await getBytes(
    src,
    ORIGINAL_MAX,
    allowSvg ? "image/svg+xml,image/*;q=0.9" : undefined
  );
  if (!full) return null;
  const fullType = rasterType(full);
  if (fullType) return { bytes: full, type: fullType, maxAge: 3_600 };
  if (allowSvg && safeSvg(full)) {
    return { bytes: full, type: "image/svg+xml", maxAge: 86_400 };
  }
  return null;
}

async function serveAndRemember(
  memKey: string,
  src: string,
  allowSvg: boolean
): Promise<Response | null> {
  const valid = await fetchValidImageBytes(src, allowSvg);
  if (!valid) return null;
  putMemoryBytes(memKey, valid.bytes, valid.type, valid.maxAge);
  return imageResponse(valid.bytes, valid.type, valid.maxAge);
}

/**
 * Race multiple image-URL promises and resolve as soon as the FIRST non-empty URL arrives.
 */
async function raceFirstUrl(
  tasks: Array<Promise<string | null>>
): Promise<string | null> {
  try {
    return await Promise.any(
      tasks.map(async (p) => {
        const u = await p;
        if (!u) throw new Error("empty");
        return u;
      })
    );
  } catch {
    return null;
  }
}

async function resolveTokenLogo(env: Env, addr: string): Promise<Response> {
  const memKey = `token:${addr}`;
  const memHit = memoryLogoBytes.get(memKey);
  if (memHit && Date.now() - memHit.at < 3_600_000) {
    return imageResponse(memHit.bytes, memHit.type, memHit.maxAge);
  }

  // Tier 0: Curated SVG/raster
  const curated = CURATED[addr];
  if (curated) {
    const res = await serveAndRemember(memKey, curated, true);
    if (res) return res;
  }

  // Tier 1: Shared in-memory URL discovered from /api/tokens, /api/launchpads, or Kleos board
  const remembered = rememberedLogos.get(addr);
  if (remembered) {
    const res = await serveAndRemember(memKey, remembered, false);
    if (res) return res;
  }

  // Tier 2: Fast-track race across indexers (resolves on FIRST hit instead of waiting for all 5!)
  const tried = new Set<string>();
  if (remembered) tried.add(remembered);

  const tasks: Array<Promise<string | null>> = [
    kleosImage(addr),
    elyxaImage(addr),
    montraImage(addr),
    boxaImage(addr),
    stockiumImage(addr),
  ];

  const firstWinner = await raceFirstUrl(tasks);
  if (firstWinner && !tried.has(firstWinner)) {
    tried.add(firstWinner);
    rememberLogoUrl(addr, firstWinner);
    const res = await serveAndRemember(memKey, firstWinner, false);
    if (res) return res;
  }

  // Tier 3: Collect any remaining settled indexer URLs + on-chain contract metadata
  const settled = await Promise.allSettled([
    ...tasks,
    onchainImages(env, addr),
  ]);
  for (const s of settled) {
    if (s.status !== "fulfilled" || !s.value) continue;
    const list = Array.isArray(s.value) ? s.value : [s.value];
    for (const raw of list) {
      const src = safeImageUrl(raw);
      if (!src || tried.has(src)) continue;
      tried.add(src);
      rememberLogoUrl(addr, src);
      const res = await serveAndRemember(memKey, src, false);
      if (res) return res;
    }
  }

  // Tier 4: If this token is an official launchpad token, fall back to its launchpad icon
  const lp = launchpadTokenOf(addr);
  if (lp) {
    const lpRes = await resolveLaunchpadLogo(env, lp.id);
    if (lpRes.status === 200) return lpRes;
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "public, max-age=180" },
  });
}

async function resolveLaunchpadLogo(env: Env, id: string): Promise<Response> {
  const keyId = id.toLowerCase();
  const memKey = `launchpad:${keyId}`;
  const memHit = memoryLogoBytes.get(memKey);
  if (memHit && Date.now() - memHit.at < 3_600_000) {
    return imageResponse(memHit.bytes, memHit.type, memHit.maxAge);
  }

  const lp = launchpadById(keyId);
  if (!lp) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "public, max-age=300" },
    });
  }

  const remembered = rememberedLaunchpadLogos.get(lp.id);
  if (remembered) {
    const res = await serveAndRemember(memKey, remembered, true);
    if (res) return res;
  }

  // Discover icon candidates from the launchpad's official site <head>
  if (lp.site) {
    try {
      const pageRes = await fetch(lp.site, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": UA,
        },
        signal: AbortSignal.timeout(3_200),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const candidates = iconCandidates(html, pageRes.url || lp.site);
        for (const raw of candidates) {
          const safe = safeImageUrl(raw);
          if (!safe) continue;
          const res = await serveAndRemember(memKey, safe, true);
          if (res) {
            rememberLaunchpadLogoUrl(lp.id, safe);
            return res;
          }
        }
      }
    } catch {
      // Fall through to platform token logo
    }
  }

  // Fall back to the launchpad's own platform token logo if it has one
  if (lp.token) {
    const tokAddr = lp.token.address.toLowerCase();
    const tokUrl =
      CURATED[tokAddr] ??
      rememberedLogos.get(tokAddr) ??
      (await raceFirstUrl([
        kleosImage(tokAddr),
        elyxaImage(tokAddr),
        boxaImage(tokAddr),
      ]));
    if (tokUrl) {
      const res = await serveAndRemember(memKey, tokUrl, true);
      if (res) {
        rememberLaunchpadLogoUrl(lp.id, tokUrl);
        return res;
      }
    }
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "public, max-age=300" },
  });
}

const inflight = new Map<string, Promise<Response>>();

export async function handleLogo(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  address: string
): Promise<Response> {
  const addr = address.toLowerCase();
  if (!ADDRESS.test(addr)) {
    return new Response(JSON.stringify({ error: "not a token address" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  // Optional ?src= hint from verified token feed for instant resolution on first sight
  const hint = new URL(req.url).searchParams.get("src");
  if (hint) rememberLogoUrl(addr, hint);

  const memHit = memoryLogoBytes.get(`token:${addr}`);
  if (memHit && Date.now() - memHit.at < 3_600_000) {
    return imageResponse(memHit.bytes, memHit.type, memHit.maxAge);
  }

  const key = `${new URL(req.url).origin}/__logo/${CACHE_VERSION}/${addr}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;

  let p = inflight.get(addr);
  if (!p) {
    p = (async () => {
      try {
        const res = await resolveTokenLogo(env, addr);
        cachePut(
          env,
          ctx,
          key,
          res,
          res.status === 200 ? 7 * 86_400 : undefined
        );
        return res;
      } finally {
        inflight.delete(addr);
      }
    })();
    inflight.set(addr, p);
  }
  return (await p).clone();
}

export async function handleLaunchpadLogo(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string
): Promise<Response> {
  const cleanId = id.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(cleanId)) {
    return new Response(JSON.stringify({ error: "invalid launchpad id" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
  }

  const memHit = memoryLogoBytes.get(`launchpad:${cleanId}`);
  if (memHit && Date.now() - memHit.at < 3_600_000) {
    return imageResponse(memHit.bytes, memHit.type, memHit.maxAge);
  }

  const key = `${new URL(req.url).origin}/__launchpad_logo/${CACHE_VERSION}/${cleanId}`;
  const hit = await cacheGet(env, key);
  if (hit) return hit;

  const inflightKey = `lp:${cleanId}`;
  let p = inflight.get(inflightKey);
  if (!p) {
    p = (async () => {
      try {
        const res = await resolveLaunchpadLogo(env, cleanId);
        cachePut(
          env,
          ctx,
          key,
          res,
          res.status === 200 ? 7 * 86_400 : undefined
        );
        return res;
      } finally {
        inflight.delete(inflightKey);
      }
    })();
    inflight.set(inflightKey, p);
  }
  return (await p).clone();
}
