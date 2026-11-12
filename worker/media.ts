// Image upload and serving for post attachments, avatars, profile covers and Premium Max badge pictures.
// - R2 (env.MEDIA) when bound; otherwise small images live in the SQLite store (rows cap at ~2 MB,
//   so the fallback accepts at most 1 MB and the client downsizes before uploading).
// - Type is decided by magic bytes (PNG, JPEG, WebP, GIF). SVG, HTML and everything else is refused.
// - Random keys, immutable caching, sandboxed CSP and nosniff on every response.
// - Per-account and site-wide quotas so free storage degrades with a clear message instead of failing silently.
import { jsonNoStore, requireMutatingUser } from "./auth.ts";
import type { Env } from "./env.ts";
import { rasterType } from "./logo.ts";
import { checkRateLimit } from "./ratelimit.ts";
import { PREMIUM, TIER_LABEL, limitsFor } from "../src/config/premium.ts";
import { setBadgeImage } from "./premium.ts";

const MB = 1024 * 1024;

export function mediaLimits(env: Env) {
  const r2 = !!env.MEDIA;
  return {
    backend: r2 ? "R2" : "SQLite",
    post: r2 ? 4 * MB : 1 * MB,
    avatar: r2 ? 2 * MB : 1 * MB,
    banner: r2 ? 4 * MB : 1 * MB,
    /** Premium Max badge picture; GIFs keep their animation, so allow a little room. */
    badge: r2 ? 1 * MB : 512 * 1024,
    perAccount: r2 ? 150 * MB : 25 * MB,
    siteWide: r2 ? 8 * 1024 * MB : 600 * MB,
  };
}

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const KEY_RE = /^(posts|avatars|banners|badges)\/[0-9a-z-]+\.(png|jpg|webp|gif)$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function keyFromUrl(url: string): string | null {
  if (!url.startsWith("/api/media/")) return null;
  const key = url.slice("/api/media/".length);
  return KEY_RE.test(key) ? key : null;
}

/** True when `url` is a media object this account uploaded, in the expected folder. */
export async function ownsMediaUrl(
  env: Env,
  userId: string,
  url: string,
  folder: "posts" | "avatars" | "banners" | "badges",
): Promise<boolean> {
  const key = keyFromUrl(url);
  if (!key || !key.startsWith(`${folder}/`) || !env.DB) return false;
  const row = await env.DB.prepare("SELECT owner_id FROM media_objects WHERE key = ?").bind(key).first<{ owner_id: string }>();
  return row?.owner_id === userId;
}

/** Removes an object the account owns (replaced avatar or cover, deleted post image). */
export async function deleteMediaByUrl(env: Env, userId: string, url: string | null): Promise<void> {
  if (!url || !env.DB) return;
  const key = keyFromUrl(url);
  if (!key) return;
  const row = await env.DB.prepare("SELECT owner_id FROM media_objects WHERE key = ?").bind(key).first<{ owner_id: string }>();
  if (row?.owner_id !== userId) return;
  if (env.MEDIA) await env.MEDIA.delete(key).catch(() => undefined);
  await env.DB.prepare("DELETE FROM media_objects WHERE key = ?").bind(key).run();
}

export async function handleMediaUpload(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "The database is not available right now. Try again in a moment." }, 503);
  const user = auth.user;

  if (!(await checkRateLimit(env.DB, `upload:${user.id}`, 20, 600_000))) {
    return jsonNoStore({ error: "You have uploaded 20 images in 10 minutes. Wait a little before the next one." }, 429);
  }

  const kind = new URL(req.url).searchParams.get("kind") || "post";
  if (kind !== "post" && kind !== "avatar" && kind !== "banner" && kind !== "badge") {
    return jsonNoStore({ error: "Unknown upload type." }, 400);
  }
  if (kind === "badge" && user.tier !== "max") {
    return jsonNoStore(
      { error: `A picture badge is a ${TIER_LABEL.max} feature. Hold ${PREMIUM.maxMinTokens.toLocaleString("en-US")} ${PREMIUM.symbol} to unlock it.` },
      403,
    );
  }
  const limits = mediaLimits(env);
  const maxBytes = limits[kind];
  const perAccount = limits.perAccount * limitsFor(user).storageX;
  const tooBig = () =>
    jsonNoStore({ error: `That image is larger than ${maxBytes >= MB ? `${Math.round(maxBytes / MB)} MB` : `${Math.round(maxBytes / 1024)} KB`}. Pick a smaller one.` }, 413);

  if (Number(req.headers.get("content-length") || "0") > maxBytes + 65536) return tooBig();

  let bytes: Uint8Array;
  try {
    if ((req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return jsonNoStore({ error: "No image was attached." }, 400);
      if (file.size > maxBytes) return tooBig();
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const ab = await req.arrayBuffer();
      if (ab.byteLength > maxBytes) return tooBig();
      bytes = new Uint8Array(ab);
    }
  } catch {
    return jsonNoStore({ error: "The upload could not be read." }, 400);
  }
  if (!bytes.byteLength) return jsonNoStore({ error: "The image file is empty." }, 400);

  const detectedType = rasterType(bytes);
  if (!detectedType || !(detectedType in EXT_FOR_TYPE)) {
    return jsonNoStore({ error: "Only PNG, JPEG, WebP and GIF images can be uploaded." }, 415);
  }

  const [mine, all] = await Promise.all([
    env.DB.prepare("SELECT SUM(size_bytes) AS b FROM media_objects WHERE owner_id = ?").bind(user.id).first<{ b: number | null }>(),
    env.DB.prepare("SELECT SUM(size_bytes) AS b FROM media_objects").first<{ b: number | null }>(),
  ]);
  if (Number(mine?.b ?? 0) + bytes.byteLength > perAccount) {
    return jsonNoStore(
      { error: `Your account has reached its ${Math.round(perAccount / MB)} MB image allowance. Delete older image posts to free space.` },
      507,
    );
  }
  if (Number(all?.b ?? 0) + bytes.byteLength > limits.siteWide) {
    return jsonNoStore({ error: "Image storage for the whole site is full right now. Text posts still work." }, 507);
  }

  const key = `${kind}s/${Date.now()}-${crypto.randomUUID().replace(/-/g, "")}.${EXT_FOR_TYPE[detectedType]}`;
  const publicUrl = `/api/media/${key}`;

  if (env.MEDIA) {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: detectedType }, customMetadata: { ownerId: user.id } });
  }
  await env.DB.prepare(
    "INSERT INTO media_objects (key, owner_id, content_type, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(key, user.id, detectedType, bytes.byteLength, env.MEDIA ? null : bytesToBase64(bytes), Date.now())
    .run();

  if (kind === "avatar") {
    await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(publicUrl, user.id).run();
    await deleteMediaByUrl(env, user.id, user.avatarUrl);
    user.avatarUrl = publicUrl;
  } else if (kind === "banner") {
    await env.DB.prepare("UPDATE users SET banner_url = ? WHERE id = ?").bind(publicUrl, user.id).run();
    await deleteMediaByUrl(env, user.id, user.bannerUrl);
    user.bannerUrl = publicUrl;
  } else if (kind === "badge") {
    await setBadgeImage(env, user, publicUrl);
  }

  return jsonNoStore({ url: publicUrl, contentType: detectedType, size: bytes.byteLength, user }, 201);
}

export async function handleMediaGet(_req: Request, env: Env, key: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (!KEY_RE.test(key)) return notFound();

  const headers = (contentType: string) => ({
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  });

  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) return new Response(obj.body, { headers: headers(obj.httpMetadata?.contentType || "image/webp") });
  }
  if (env.DB) {
    const row = await env.DB.prepare("SELECT content_type, data_base64 FROM media_objects WHERE key = ?")
      .bind(key)
      .first<{ content_type: string; data_base64: string | null }>();
    if (row?.data_base64) {
      return new Response(base64ToBytes(row.data_base64) as unknown as BodyInit, { headers: headers(row.content_type) });
    }
  }
  return notFound();
}
