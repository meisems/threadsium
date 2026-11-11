import type { SocialStore } from "./store.ts";

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
  batch(stmts: SqlStatement[]): Promise<unknown>;
}

export interface Env {
  ASSETS: Fetcher;
  /** Built-in SQLite Durable Object for relational social state on Workers Free. */
  SOCIAL_DO?: DurableObjectNamespace<SocialStore>;
  /** Optional Cloudflare D1 binding; if unbound, derived automatically from SOCIAL_DO. */
  DB?: SqlDb;
  /** Optional Cloudflare KV namespace for public token index & logo caching. */
  CACHE?: KVNamespace;
  /** Optional Cloudflare R2 bucket for user post images, avatars, and banners. */
  MEDIA?: R2Bucket;
  /** Optional keyed Elysium 99901 RPC URL secret. */
  RPC_URL?: string;
  /** Comma-separated public Elysium 99901 RPC endpoints. */
  RPC_FALLBACKS?: string;
  /** Optional base URL of a running Elywake deployment (e.g. https://elywake.example.workers.dev); /api/whales reads its signals when set. */
  ELYWAKE_API?: string;
  /** Extra allowed origins (comma-separated). */
  ALLOWED_ORIGINS?: string;
}
