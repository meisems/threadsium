import type { WhaleIndexer } from "./whales/indexer.ts";
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
  /** Whale watch indexer (worker/whales/indexer.ts). */
  WHALES_DO?: DurableObjectNamespace<WhaleIndexer>;
  /** Optional Cloudflare D1 binding; if unbound, derived automatically from SOCIAL_DO. */
  DB?: SqlDb;
  /** Optional Cloudflare KV namespace for public token index & logo caching. */
  CACHE?: KVNamespace;
  /** Optional Cloudflare R2 bucket for user post images, avatars, and banners. */
  MEDIA?: R2Bucket;
  /** Optional keyed Elysium 99901 RPC URL secret. */
  RPC_URL?: string;
  /** Comma-separated launchpad Elysium 99901 RPC endpoints, for every read except Whale watch scans. */
  RPC_FALLBACKS?: string;
  /** THREADSIUM ERC-20 on 99901 used for Premium; overrides PREMIUM.tokenAddress in src/config/premium.ts. */
  PREMIUM_TOKEN_ADDRESS?: string;
  /** Uniswap V3 THREADSIUM/WHYPE pool whose time-weighted price values HYPE payments for Premium. */
  PREMIUM_PRICE_POOL?: string;
  /** Comma-separated public Elysium 99901 RPC endpoints, used only for Whale watch scans. */
  RPC_PUBLIC?: string;
  /** Secret: the keyed Alchemy Elysium endpoint (full URL with the key). Swap reads through /api/rpc?for=swap try it first. */
  ALCHEMY_RPC_URL?: string;
  /** Extra allowed origins (comma-separated). */
  ALLOWED_ORIGINS?: string;
}
