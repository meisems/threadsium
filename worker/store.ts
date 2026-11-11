// Relational social store backed by a SQLite Durable Object ("social-v1") on Workers Free,
// or Cloudflare D1 when bound directly as env.DB.
import { DurableObject } from "cloudflare:workers";
import m0001 from "../migrations/0001_threadsium.sql";
import m0002 from "../migrations/0002_social_v2.sql";
import m0003 from "../migrations/0003_message_transfers.sql";
import m0004 from "../migrations/0004_launch_index.sql";
import type { Env, SqlDb, SqlStatement } from "./env.ts";

export const MIGRATIONS: [name: string, sql: string][] = [
  ["0001_threadsium", m0001],
  ["0002_social_v2", m0002],
  ["0003_message_transfers", m0003],
  ["0004_launch_index", m0004],
];

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
   * First boot only: one clearly labelled system account with three starter posts, so links to token rooms
   * and the verified contract list work before anyone has signed up. It cannot be signed in to.
   */
  private seedInitialCommunity(): void {
    const sql = this.ctx.storage.sql;
    const count = sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM users").toArray()[0]?.c ?? 0;
    if (count > 0) return;

    const now = Date.now();
    const post = (id: string, content: string, refs: string[], room: string | null, at: number) =>
      sql.exec(
        "INSERT INTO posts (id, author_id, content, token_refs, room_address, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        "u_elysium_desk",
        content,
        JSON.stringify(refs),
        room,
        at,
      );
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        `INSERT INTO users (id, username, password_hash, password_salt, display_name, bio, avatar_preset, show_connections, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "u_elysium_desk",
        "elysium_desk",
        "system_locked",
        "system_locked",
        "Elysium Desk",
        "System account. Posts network notes and the verified contract list for Elysium (chain 99901). Nobody reads its messages.",
        "saffron",
        1,
        now - 3600_000 * 6,
      );
      post(
        "p_welcome_1",
        "Welcome to Threadsium, the social network for Elysium (chain 99901). Write $KNTQ, $BOXA, $KLEOS or $ELYXA, or paste any 0x contract address, and the post links to that token's room with its on-chain chart. #elysium #hype",
        ["KNTQ", "BOXA", "KLEOS", "ELYXA", "#elysium", "#hype"],
        null,
        now - 3600_000 * 4,
      );
      post(
        "p_room_kntq_1",
        "$KNTQ is the Kinetiq governance token. It trades against HYPE on BOXA V3, StockiumSwap and Uniswap V4 pools. The chart in this room is built from those pools' swap logs.",
        ["KNTQ"],
        "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
        now - 3600_000 * 3,
      );
      post(
        "p_welcome_2",
        [
          "Contract addresses the ecosystem's own sites publish:",
          "$KNTQ 0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
          "$BOXA 0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
          "$KLEOS 0x51c343ed5131f17895991849860b61c2cb0e7e7a",
          "$ELYXA 0xbd61e339a53fe9a27b8dba6dfdb63f443cbec077",
          "$OBOL 0xdc34b3a34a3f84998d2aaea9c31c9c86318b5b51",
          "Check the address before you trade. Tickers can be copied; addresses cannot.",
        ].join("\n"),
        [
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
        ],
        null,
        now - 3600_000 * 2,
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

  broadcastRoom(room: string, payload: string): number {
    const tag = `room:${room.toLowerCase()}`;
    const sockets = this.ctx.getWebSockets(tag);
    let sent = 0;
    for (const ws of sockets) {
      try {
        ws.send(payload);
        sent++;
      } catch {
        try {
          ws.close(1011, "send failed");
        } catch {
          /* ignore */
        }
      }
    }
    return sent;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const room = (url.searchParams.get("room") || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(room)) {
      return new Response(JSON.stringify({ error: "Invalid room address" }), { status: 400 });
    }
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response(JSON.stringify({ ok: true, room }), {
        headers: { "content-type": "application/json" },
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`room:${room}`]);
    try {
      server.send(JSON.stringify({ type: "connected", room, roomId: `99901-${room}`, ts: Date.now() }));
    } catch {
      /* ignore */
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text === "ping" || text.includes('"ping"')) {
      try {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      } catch {
        /* ignore */
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* ignore */
    }
  }
}

export async function broadcastToRoom(env: Env, roomAddress: string, event: Record<string, unknown>): Promise<void> {
  if (!env.SOCIAL_DO) return;
  const addr = roomAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) return;
  try {
    const stub = env.SOCIAL_DO.get(env.SOCIAL_DO.idFromName("social-v1"));
    await stub.broadcastRoom(addr, JSON.stringify({ ...event, room: addr, roomId: `99901-${addr}`, ts: Date.now() }));
  } catch {
    /* non-fatal if no websocket listeners */
  }
}

export async function connectRoomWebSocket(req: Request, env: Env, roomAddress: string): Promise<Response> {
  const addr = roomAddress.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ error: "That is not a token contract address." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!env.SOCIAL_DO) {
    return new Response(JSON.stringify({ error: "Real-time room stream is unavailable; use /api/rooms/:address/sync polling." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const stub = env.SOCIAL_DO.get(env.SOCIAL_DO.idFromName("social-v1"));
  const wsUrl = new URL(req.url);
  wsUrl.searchParams.set("room", addr);
  return stub.fetch(new Request(wsUrl.toString(), req));
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
    env.DB.prepare("DELETE FROM wallet_challenges WHERE expires_at < ?").bind(now),
  ]);
}
