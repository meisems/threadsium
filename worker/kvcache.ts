// Shared cache for public API responses (R09).
// Only public, non-personalized responses reach cacheGet/cachePut.
// Personalized/authenticated routes (/api/auth/*, /api/notifications, /api/messages, mutations) use Cache-Control: no-store.
import type { Env } from "./env.ts";

const KEPT_HEADERS = ["content-type", "cache-control", "content-security-policy", "x-content-type-options", "etag"];
const KV_MAX_BYTES = 512 * 1024;

interface Meta {
  s: number;
  h: Record<string, string>;
}

export async function cacheGet(env: Env, key: string): Promise<Response | null> {
  const edge = await caches.default.match(new Request(key)).catch(() => undefined);
  if (edge) return edge;
  if (!env.CACHE) return null;
  const hit = await env.CACHE.getWithMetadata<Meta>(kvKey(key), { type: "arrayBuffer", cacheTtl: 300 }).catch(() => null);
  if (!hit?.value || !hit.metadata) return null;
  return new Response(hit.value, { status: hit.metadata.s, headers: hit.metadata.h });
}

export function cachePut(env: Env, ctx: ExecutionContext, key: string, res: Response, kvTtl?: number): void {
  ctx.waitUntil(caches.default.put(new Request(key), res.clone()).catch(() => undefined));
  if (!env.CACHE || !kvTtl || res.status !== 200) return;
  const copy = res.clone();
  ctx.waitUntil(
    (async () => {
      const body = await copy.arrayBuffer();
      if (body.byteLength > KV_MAX_BYTES) return;
      const h: Record<string, string> = {};
      for (const name of KEPT_HEADERS) {
        const v = copy.headers.get(name);
        if (v) h[name] = v;
      }
      await env.CACHE!.put(kvKey(key), body, {
        expirationTtl: Math.max(60, Math.floor(kvTtl)),
        metadata: { s: copy.status, h } satisfies Meta,
      });
    })().catch(() => undefined),
  );
}

function kvKey(key: string): string {
  const u = new URL(key);
  return `c:${u.pathname}${u.search}`.slice(0, 500);
}
