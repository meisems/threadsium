// Safe binary upload & serving for user post attachments, avatars, and profile banners (R02 & R12).
// - Uses Cloudflare R2 (env.MEDIA) when bound, with automatic fallback to SQLite media_objects on Workers Free.
// - Strict magic-byte inspection (PNG, JPEG, WebP, GIF only; rejects SVG, HTML, scripts, executables).
// - Content-addressed / UUID keys served with immutable Cache-Control and sandboxed CSP.
import { jsonNoStore, requireMutatingUser } from "./auth.ts";
import type { Env } from "./env.ts";
import { rasterType } from "./logo.ts";
import { checkRateLimit } from "./store.ts";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_BANNER_BYTES = 4 * 1024 * 1024; // 4 MB
const MAX_POST_BYTES = 4 * 1024 * 1024; // 4 MB

const EXT_FOR_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

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

export async function handleMediaUpload(req: Request, env: Env): Promise<Response> {
  const auth = await requireMutatingUser(req, env);
  if ("error" in auth) return auth.error;
  if (!env.DB) return jsonNoStore({ error: "Database unavailable." }, 503);

  const user = auth.user;
  if (!(await checkRateLimit(env.DB, `upload:${user.id}`, 20, 600_000))) {
    return jsonNoStore({ error: "Upload rate limit reached (max 20 per 10 minutes)." }, 429);
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "post";
  if (kind !== "post" && kind !== "avatar" && kind !== "banner") {
    return jsonNoStore({ error: "Invalid upload kind." }, 400);
  }

  const maxBytes = kind === "avatar" ? MAX_AVATAR_BYTES : kind === "banner" ? MAX_BANNER_BYTES : MAX_POST_BYTES;
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > maxBytes + 65536) {
    return jsonNoStore({ error: `Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.` }, 413);
  }

  let bytes: Uint8Array;
  const ctHeader = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ctHeader.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return jsonNoStore({ error: "Missing 'file' field in multipart upload." }, 400);
      }
      if (file.size > maxBytes) {
        return jsonNoStore({ error: `Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.` }, 413);
      }
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      const ab = await req.arrayBuffer();
      if (!ab || ab.byteLength === 0) {
        return jsonNoStore({ error: "Empty upload body." }, 400);
      }
      if (ab.byteLength > maxBytes) {
        return jsonNoStore({ error: `Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.` }, 413);
      }
      bytes = new Uint8Array(ab);
    }
  } catch {
    return jsonNoStore({ error: "Could not read upload body." }, 400);
  }

  const detectedType = rasterType(bytes);
  if (!detectedType || !(detectedType in EXT_FOR_TYPE)) {
    return jsonNoStore({ error: "Unsupported image format. Only PNG, JPEG, WebP, and GIF raster images are allowed." }, 415);
  }

  const ext = EXT_FOR_TYPE[detectedType];
  const rand = crypto.randomUUID().replace(/-/g, "");
  const key = `${kind}s/${Date.now()}-${rand}.${ext}`;
  const publicUrl = `/api/media/${key}`;

  if (env.MEDIA) {
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: detectedType },
      customMetadata: { ownerId: user.id },
    });
    await env.DB.prepare(
      "INSERT INTO media_objects (key, owner_id, content_type, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    )
      .bind(key, user.id, detectedType, bytes.byteLength, Date.now())
      .run();
  } else {
    const b64 = bytesToBase64(bytes);
    await env.DB.prepare(
      "INSERT INTO media_objects (key, owner_id, content_type, size_bytes, data_base64, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(key, user.id, detectedType, bytes.byteLength, b64, Date.now())
      .run();
  }

  if (kind === "avatar") {
    await env.DB.prepare("UPDATE users SET avatar_url = ?, avatar_preset = NULL WHERE id = ?").bind(publicUrl, user.id).run();
    user.avatarUrl = publicUrl;
    user.avatarPreset = null;
  } else if (kind === "banner") {
    await env.DB.prepare("UPDATE users SET banner_url = ? WHERE id = ?").bind(publicUrl, user.id).run();
    user.bannerUrl = publicUrl;
  }

  return jsonNoStore({ url: publicUrl, key, contentType: detectedType, mimeType: detectedType, size: bytes.byteLength, byteSize: bytes.byteLength, user }, 201);
}

export async function handleMediaGet(_req: Request, env: Env, key: string): Promise<Response> {
  if (!/^(posts|avatars|banners)\/[0-9a-z-]+\.(png|jpg|webp|gif)$/.test(key)) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const headers = (contentType: string) => ({
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  });

  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) {
      return new Response(obj.body, {
        headers: headers(obj.httpMetadata?.contentType || "image/webp"),
      });
    }
  }

  if (env.DB) {
    const row = await env.DB.prepare("SELECT content_type, data_base64 FROM media_objects WHERE key = ?")
      .bind(key)
      .first<{ content_type: string; data_base64: string | null }>();
    if (row?.data_base64) {
      const bytes = base64ToBytes(row.data_base64);
      return new Response(bytes as unknown as BodyInit, {
        headers: headers(row.content_type),
      });
    }
  }

  return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
}
