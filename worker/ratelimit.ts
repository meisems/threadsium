// Fixed-window rate limits kept in the relational store. Lives apart from store.ts (which needs the Workers runtime)
// so the auth handlers can be exercised under node --test.
import type { SqlDb } from "./env.ts";

/** Distributed rate limit check stored in D1 / SocialStore (R12). Returns true if allowed, false if rate-limited. */
export async function checkRateLimit(db: SqlDb, key: string, maxRequests: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const existing = await db
    .prepare("SELECT window_start, count FROM rate_limits WHERE key = ?")
    .bind(key)
    .first<{ window_start: number; count: number }>();

  if (!existing || existing.window_start < windowStart) {
    await db
      .prepare("INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
      .bind(key, windowStart)
      .run();
    return true;
  }
  if (existing.count >= maxRequests) return false;
  await db
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
    .bind(key)
    .run();
  return true;
}
