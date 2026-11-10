// Relational social store backed by a SQLite Durable Object ("social-v1") on Workers Free,
// or Cloudflare D1 when bound directly as env.DB.
import { DurableObject } from "cloudflare:workers";
import m0001 from "../migrations/0001_threadsium.sql";
import type { Env, SqlDb, SqlStatement } from "./env.ts";

export const MIGRATIONS: [name: string, sql: string][] = [["0001_threadsium", m0001]];

type Param = string | number | null;
type Row = Record<string, string | number | null>;

export class SocialStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.seedInitialCommunity();
    });
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const done = new Set(sql.exec<{ name: string }>("SELECT name FROM _migrations").toArray().map((r) => r.name));
    for (const [name, text] of MIGRATIONS) {
      if (done.has(name)) continue;
      this.ctx.storage.transactionSync(() => {
        for (const stmt of splitSql(text)) sql.exec(stmt);
        sql.exec("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", name, Date.now());
      });
    }
  }

  /**
   * Seeds clearly-labeled system starter posts on first boot so the Hall of Fame and Token Timelines
   * demonstrate real on-chain token links ($KNTQ, $BOXA, $KLEOS, $ELYXA, $OBOL) out of the box.
   */
  private seedInitialCommunity(): void {
    const sql = this.ctx.storage.sql;
    const count = sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM users").toArray()[0]?.c ?? 0;
    if (count > 0) return;

    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        `INSERT INTO users (id, username, password_hash, password_salt, display_name, bio, avatar_preset, wallet_address, wallet_verified, show_connections, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "u_elysium_desk",
        "elysium_desk",
        "system_locked",
        "system_locked",
        "Elysium Trench Desk (System)",
        "Automated network notes & verified contract directory for Elysium 99901 (provisional). Official launchpad contracts only.",
        "kinepip-samurai",
        "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
        1,
        1,
        now - 3600_000 * 6,
      );

      sql.exec(
        `INSERT INTO posts (id, author_id, content, token_refs, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        "p_welcome_1",
        "u_elysium_desk",
        "Welcome to Threadsium on Elysium (chain 99901 · provisional). Track graduated and active tokens across BOXA, Kleos, ELYXA, Obol, Eleos, and Ronspad. Mention $KNTQ, $BOXA, $KLEOS, $ELYXA, or paste any 0x contract address to link directly to its live on-chain swap chart and community timeline. #elysium #hype",
        JSON.stringify(["KNTQ", "BOXA", "KLEOS", "ELYXA", "#elysium", "#hype"]),
        now - 3600_000 * 4,
      );

      sql.exec(
        `INSERT INTO posts (id, author_id, content, token_refs, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        "p_welcome_2",
        "u_elysium_desk",
        "Verified launchpad & ecosystem tokens indexed on chain 99901:\n• $KNTQ: 0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0\n• $BOXA: 0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7\n• $KLEOS: 0x51c343ed5131f17895991849860b61c2cb0e7e7a\n• $ELYXA: 0xbd61e339a53fe9a27b8dba6dfdb63f443cbec077\n• $OBOL: 0xdc34b3a34a3f84998d2aaea9c31c9c86318b5b51\n#trenches",
        JSON.stringify([
          "KNTQ",
          "BOXA",
          "KLEOS",
          "ELYXA",
          "OBOL",
          "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
          "0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
          "0x51c343ed5131f17895991849860b61c2cb0e7e7a",
          "0xbd61e339a53fe9a27b8dba6dfdb63f443cbec077",
          "0xdc34b3a34a3f84998d2aaea9c31c9c86318b5b51",
          "#trenches",
        ]),
        now - 3600_000 * 2,
      );

      sql.exec(
        `INSERT INTO token_comments (id, author_id, token_address, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        "c_kntq_1",
        "u_elysium_desk",
        "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
        "KNTQ (Kinetiq Governance Token) trades across BOXA V3, StockiumSwap, and Uniswap V4 pools against native HYPE.",
        now - 3600_000 * 3,
      );
    });
  }

  query(text: string, params: Param[] = []): Row[] {
    return this.ctx.storage.sql.exec<Row>(text, ...params).toArray();
  }

  batch(stmts: [text: string, params: Param[]][]): number {
    this.ctx.storage.transactionSync(() => {
      for (const [text, params] of stmts) this.ctx.storage.sql.exec(text, ...params);
    });
    return stmts.length;
  }
}

export function splitSql(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function socialDb(ns: DurableObjectNamespace<SocialStore>): SqlDb {
  const stub = () => ns.get(ns.idFromName("social-v1"));
  class Stmt implements SqlStatement {
    constructor(
      readonly text: string,
      readonly params: Param[] = [],
    ) {}
    bind(...values: unknown[]): SqlStatement {
      return new Stmt(
        this.text,
        values.map((v) => (v === undefined ? null : typeof v === "bigint" ? v.toString() : (v as Param))),
      );
    }
    async first<T = Row>(): Promise<T | null> {
      const rows = (await stub().query(this.text, this.params)) as unknown as T[];
      return rows[0] ?? null;
    }
    async all<T = Row>(): Promise<{ results: T[] }> {
      return { results: (await stub().query(this.text, this.params)) as unknown as T[] };
    }
    async run(): Promise<{ success: true }> {
      await stub().query(this.text, this.params);
      return { success: true };
    }
  }
  return {
    prepare: (text) => new Stmt(text),
    batch: async (stmts) => stub().batch(stmts.map((s) => [(s as Stmt).text, (s as Stmt).params])),
  };
}

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

/** Hourly maintenance: prune expired sessions, old rate-limit buckets, and notifications older than 12h. */
export async function cleanupStore(env: Env): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  const twelveHoursAgo = now - 12 * 3600_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 3600_000),
    env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(twelveHoursAgo),
  ]);
}
