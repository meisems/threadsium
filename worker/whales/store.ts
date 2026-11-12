// SQLite persistence. The same SQL runs in the Durable Object's SQLite storage (production) and in node:sqlite
// (scripts/replay.ts, tests) through the small SqlExec interface. Schema follows the build prompt: tokens, wallets,
// trades UNIQUE(tx_hash, log_index), signals, cursor; plus token_hourly for 24h token stats and cluster_members so a
// wallet page can list its cluster siblings without scanning. Arrays are JSON text (SQLite has no array type).
//
// Free-tier accounting: every statement's rowsWritten/rowsRead is summed per UTC day. Index rows count as writes on
// Cloudflare, so tables keep as few indexes as the API needs.

import type { HourlyRow, Store, StoredTrade, TokenRow, WalletRow } from "./pipeline.ts";
import type { Address, SignalRecord, SignalType, TokenMeta } from "./types.ts";

export interface SqlCursor { toArray(): Record<string, unknown>[]; rowsWritten: number; rowsRead: number }
export interface SqlExec { exec(query: string, ...bindings: unknown[]): SqlCursor }

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tokens (address TEXT PRIMARY KEY, symbol TEXT, name TEXT, decimals INTEGER, first_seen_block INTEGER, first_seen_at INTEGER, launchpad TEXT) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS wallets (address TEXT PRIMARY KEY, first_seen_at INTEGER, nonce_at_first_seen INTEGER, funded_by TEXT, funded_at INTEGER, funding_kind TEXT, label TEXT) WITHOUT ROWID`,
  // (tx_hash, log_index) is the primary key (the prompt's UNIQUE constraint) in a WITHOUT ROWID table: one row per
  // insert plus one per index, instead of an extra unique index.
  `CREATE TABLE IF NOT EXISTS trades (tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, block_number INTEGER NOT NULL, block_time INTEGER NOT NULL, wallet TEXT NOT NULL, token TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('BUY','SELL')), amount_token TEXT NOT NULL, amount_in_hype REAL, base_asset TEXT, launchpad TEXT, wallet_nonce INTEGER, fresh INTEGER, tx_to TEXT, PRIMARY KEY (tx_hash, log_index)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS trades_token ON trades (token, block_time)`,
  `CREATE INDEX IF NOT EXISTS trades_wallet ON trades (wallet, block_time)`,
  // Recent buys across every token (Whale watch's Buys list): a partial index, one extra row per stored buy.
  `CREATE INDEX IF NOT EXISTS trades_buys_time ON trades (block_time) WHERE side = 'BUY'`,
  `CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY, type TEXT NOT NULL, token TEXT NOT NULL, token_symbol TEXT, wallet TEXT, cluster_wallets TEXT, funded_by TEXT, trade_keys TEXT NOT NULL, amount_in_hype REAL, hype_usd REAL, launchpad TEXT, tx_hash TEXT NOT NULL, block_number INTEGER NOT NULL, created_at INTEGER NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, wallet_nonce INTEGER, wallet_funded_at INTEGER, buy_count INTEGER, posted_to_telegram INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS signals_type ON signals (type, id)`,
  `CREATE INDEX IF NOT EXISTS signals_token ON signals (token, id)`,
  `CREATE INDEX IF NOT EXISTS signals_wallet ON signals (wallet, id)`,
  `CREATE INDEX IF NOT EXISTS signals_unposted ON signals (id) WHERE posted_to_telegram = 0`,
  `CREATE TABLE IF NOT EXISTS cluster_members (wallet TEXT NOT NULL, signal_id INTEGER NOT NULL, PRIMARY KEY (wallet, signal_id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS token_hourly (token TEXT NOT NULL, hour INTEGER NOT NULL, buys INTEGER NOT NULL, fresh_buys INTEGER NOT NULL, whale_buys INTEGER NOT NULL, volume_hype REAL NOT NULL, PRIMARY KEY (token, hour)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS cursor (chain TEXT PRIMARY KEY, last_block INTEGER NOT NULL, updated_at INTEGER NOT NULL, usage_day TEXT, rows_written INTEGER NOT NULL DEFAULT 0, rows_read INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`,
];

export interface SignalRow extends SignalRecord { id: number; postedToTelegram: number }
export interface TradeRow { txHash: string; logIndex: number; blockNumber: number; blockTime: number; wallet: string; token: string; side: string; amountToken: string; amountInHype: number | null; baseAsset: string; launchpad: string; walletNonce: number | null; fresh: boolean | null; symbol?: string | null }

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export function signalFromRow(row: Record<string, unknown>): SignalRow {
  return {
    id: Number(row.id), type: row.type as SignalType, token: row.token as Address, tokenSymbol: (row.token_symbol as string) ?? null,
    wallet: (row.wallet as Address) ?? null, clusterWallets: parse<Address[] | null>(row.cluster_wallets, null), fundedBy: (row.funded_by as Address) ?? null,
    tradeKeys: parse<string[]>(row.trade_keys, []), amountInHype: n(row.amount_in_hype), hypeUsd: n(row.hype_usd),
    launchpad: (row.launchpad && row.launchpad !== "unknown" ? row.launchpad as string : (row.token_launchpad as string) ?? "unknown") || "unknown",
    txHash: row.tx_hash as `0x${string}`, blockNumber: Number(row.block_number), createdAt: Number(row.created_at), dedupeKey: row.dedupe_key as string,
    walletNonce: n(row.wallet_nonce), walletFundedAt: n(row.wallet_funded_at), buyCount: n(row.buy_count) ?? undefined, postedToTelegram: Number(row.posted_to_telegram),
  };
}
function tradeFromRow(row: Record<string, unknown>): TradeRow {
  return {
    txHash: row.tx_hash as string, logIndex: Number(row.log_index), blockNumber: Number(row.block_number), blockTime: Number(row.block_time),
    wallet: row.wallet as string, token: row.token as string, side: row.side as string, amountToken: row.amount_token as string, amountInHype: n(row.amount_in_hype),
    baseAsset: row.base_asset as string, launchpad: (row.launchpad as string) ?? "unknown", walletNonce: n(row.wallet_nonce), fresh: row.fresh === null || row.fresh === undefined ? null : Boolean(row.fresh),
    symbol: (row.symbol as string) ?? null,
  };
}

export class SqlStore implements Store {
  private day = "";
  /** The cursor lives in memory and is written at most every CURSOR_WRITE_MS (and at the end of each loop), which
   * saves about 30,000 rows written a day. After a restart up to that much is re-read; inserts are idempotent. */
  private cursor: number | null = null;
  private cursorWrittenAt = 0;
  private cursorDirty = false;
  static CURSOR_WRITE_MS = 15_000;
  rowsWritten = 0;
  rowsRead = 0;
  /** Rows written since start, by statement (first words of the SQL), so /health shows where the write budget goes. */
  readonly writesBy = new Map<string, number>();

  private readonly sql: SqlExec;
  private readonly chain: string;
  private readonly dailyWriteBudget: number;
  private readonly now: () => number;
  constructor(sql: SqlExec, chain: string, dailyWriteBudget: number, now: () => number = Date.now) {
    this.sql = sql; this.chain = chain; this.dailyWriteBudget = dailyWriteBudget; this.now = now;
    for (const statement of SCHEMA) this.run(statement);
    const row = this.all(`SELECT usage_day, rows_written, rows_read FROM cursor WHERE chain = ?`, chain)[0];
    if (row && row.usage_day === this.today()) { this.day = String(row.usage_day); this.rowsWritten = Number(row.rows_written); this.rowsRead = Number(row.rows_read); }
  }

  private today() { return new Date(this.now()).toISOString().slice(0, 10); }
  private roll() { const today = this.today(); if (today !== this.day) { this.day = today; this.rowsWritten = 0; this.rowsRead = 0; } }
  run(query: string, ...bindings: unknown[]) {
    this.roll();
    const cursor = this.sql.exec(query, ...bindings); const rows = cursor.toArray();
    this.rowsWritten += cursor.rowsWritten; this.rowsRead += cursor.rowsRead;
    if (cursor.rowsWritten) { const kind = query.trim().split(/\s+/).slice(0, 3).join(" ").replace(/\(.*$/, ""); this.writesBy.set(kind, (this.writesBy.get(kind) ?? 0) + cursor.rowsWritten); }
    return rows;
  }
  all(query: string, ...bindings: unknown[]) { return this.run(query, ...bindings); }
  /** Writes made outside SQL that the platform bills as rows (each setAlarm is one). */
  countWrites(rows: number) { this.roll(); this.rowsWritten += rows; this.writesBy.set("setAlarm", (this.writesBy.get("setAlarm") ?? 0) + rows); }
  get usageDay() { this.roll(); return this.day; }

  getCursor(): number | null {
    if (this.cursor !== null) return this.cursor;
    const row = this.all(`SELECT last_block FROM cursor WHERE chain = ?`, this.chain)[0];
    this.cursor = row ? Number(row.last_block) : null;
    return this.cursor;
  }
  setCursor(block: number) {
    this.cursor = block; this.cursorDirty = true;
    if (this.now() - this.cursorWrittenAt >= SqlStore.CURSOR_WRITE_MS) this.flushCursor();
  }
  /** Write the cursor and the day's usage counters now. */
  flushCursor() {
    if (this.cursor === null || !this.cursorDirty) return;
    this.roll();
    this.cursorDirty = false; this.cursorWrittenAt = this.now();
    this.run(`INSERT INTO cursor (chain, last_block, updated_at, usage_day, rows_written, rows_read) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (chain) DO UPDATE SET last_block = excluded.last_block, updated_at = excluded.updated_at, usage_day = excluded.usage_day, rows_written = excluded.rows_written, rows_read = excluded.rows_read`,
      this.chain, this.cursor, this.now(), this.day, this.rowsWritten + 1, this.rowsRead);
  }
  canWriteTrades() { this.roll(); return this.rowsWritten < this.dailyWriteBudget; }
  writeBudgetLeft() { this.roll(); return Math.max(0, this.dailyWriteBudget - this.rowsWritten); }

  knownToken(address: Address): TokenMeta | null {
    const row = this.all(`SELECT address, symbol, name, decimals FROM tokens WHERE address = ?`, address)[0];
    return row ? { address, symbol: (row.symbol as string) ?? null, name: (row.name as string) ?? null, decimals: n(row.decimals) } : null;
  }
  knownLaunchpad(address: Address): string | null {
    const row = this.all(`SELECT launchpad FROM tokens WHERE address = ?`, address)[0];
    return row ? ((row.launchpad as string) ?? null) : null;
  }
  saveTokens(rows: TokenRow[]) {
    // A token first stored as unknown gets its launchpad once one is resolved; a known one is never overwritten.
    for (const row of rows) this.run(`INSERT INTO tokens (address, symbol, name, decimals, first_seen_block, first_seen_at, launchpad) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (address) DO UPDATE SET launchpad = excluded.launchpad WHERE (tokens.launchpad IS NULL OR tokens.launchpad = 'unknown') AND excluded.launchpad != 'unknown'`,
      row.address, row.symbol, row.name, row.decimals, row.firstSeenBlock, row.firstSeenAt, row.launchpad);
  }
  saveWallets(rows: WalletRow[]) {
    for (const row of rows) {
      const settled = row.fundingKind !== "pending" && row.fundingKind !== "unknown";
      this.run(`INSERT INTO wallets (address, first_seen_at, nonce_at_first_seen, funded_by, funded_at, funding_kind) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (address) DO UPDATE SET funded_by = coalesce(excluded.funded_by, wallets.funded_by), funded_at = coalesce(excluded.funded_at, wallets.funded_at), funding_kind = excluded.funding_kind
        WHERE ? AND (wallets.funding_kind IS NOT excluded.funding_kind OR wallets.funded_by IS NOT excluded.funded_by)`,
        row.address, row.firstSeenAt || null, row.nonce, row.fundedBy, row.fundedAt, row.fundingKind, settled ? 1 : 0);
    }
  }
  updateLaunchpads(labels: Map<Address, string>) {
    for (const [token, name] of labels) this.run(`UPDATE tokens SET launchpad = ? WHERE address = ? AND (launchpad IS NULL OR launchpad = 'unknown')`, name, token);
  }
  saveTrades(rows: StoredTrade[]) {
    for (const row of rows) this.run(`INSERT INTO trades (tx_hash, log_index, block_number, block_time, wallet, token, side, amount_token, amount_in_hype, base_asset, launchpad, wallet_nonce, fresh, tx_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
      row.txHash, row.logIndex, row.blockNumber, row.blockTime, row.wallet, row.token, row.side, row.amountToken.toString(), row.amountInHype, row.baseAsset, row.launchpad,
      row.walletNonce, row.fresh === null ? null : row.fresh ? 1 : 0, row.txTo);
  }
  saveSignals(rows: SignalRecord[]): SignalRecord[] {
    const inserted: SignalRecord[] = [];
    for (const row of rows) {
      const result = this.run(`INSERT INTO signals (type, token, token_symbol, wallet, cluster_wallets, funded_by, trade_keys, amount_in_hype, hype_usd, launchpad, tx_hash, block_number, created_at, dedupe_key, wallet_nonce, wallet_funded_at, buy_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        row.type, row.token, row.tokenSymbol, row.wallet, row.clusterWallets ? json(row.clusterWallets) : null, row.fundedBy, json(row.tradeKeys), row.amountInHype, row.hypeUsd,
        row.launchpad, row.txHash, row.blockNumber, row.createdAt, row.dedupeKey, row.walletNonce, row.walletFundedAt, row.buyCount ?? null);
      if (!result.length) continue;
      const id = Number(result[0].id);
      for (const wallet of row.clusterWallets ?? []) this.run(`INSERT INTO cluster_members (wallet, signal_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, wallet, id);
      inserted.push({ ...row, id });
    }
    return inserted;
  }
  addHourly(rows: HourlyRow[]) {
    for (const row of rows) this.run(`INSERT INTO token_hourly (token, hour, buys, fresh_buys, whale_buys, volume_hype) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (token, hour) DO UPDATE SET buys = buys + excluded.buys, fresh_buys = fresh_buys + excluded.fresh_buys, whale_buys = whale_buys + excluded.whale_buys, volume_hype = volume_hype + excluded.volume_hype`,
      row.token, row.hour, row.buys, row.freshBuys, row.whaleBuys, row.volumeHype);
  }

  // ---- Reads for the API (bounded, index-backed) ----

  listSignals(filter: { type?: SignalType | null; token?: string | null; wallet?: string | null; before?: number | null; limit: number }): SignalRow[] {
    const where: string[] = []; const args: unknown[] = [];
    if (filter.type) { where.push("type = ?"); args.push(filter.type); }
    if (filter.token) { where.push("token = ?"); args.push(filter.token); }
    if (filter.wallet) { where.push("wallet = ?"); args.push(filter.wallet); }
    if (filter.before) { where.push("id < ?"); args.push(filter.before); }
    const sql = `SELECT s.*, t.launchpad AS token_launchpad FROM signals s LEFT JOIN tokens t ON t.address = s.token ${where.length ? `WHERE ${where.map((w) => `s.${w}`).join(" AND ")}` : ""} ORDER BY s.id DESC LIMIT ?`;
    return this.all(sql, ...args, filter.limit).map(signalFromRow);
  }
  signalsSince(id: number, limit: number): SignalRow[] { return this.all(`SELECT s.*, t.launchpad AS token_launchpad FROM signals s LEFT JOIN tokens t ON t.address = s.token WHERE s.id > ? ORDER BY s.id ASC LIMIT ?`, id, limit).map(signalFromRow); }
  clusterSignalsFor(wallet: string, limit: number): SignalRow[] {
    return this.all(`SELECT s.*, t.launchpad AS token_launchpad FROM cluster_members m JOIN signals s ON s.id = m.signal_id LEFT JOIN tokens t ON t.address = s.token WHERE m.wallet = ? ORDER BY s.id DESC LIMIT ?`, wallet, limit).map(signalFromRow);
  }
  token(address: string) {
    const row = this.all(`SELECT * FROM tokens WHERE address = ?`, address)[0] ?? null;
    const trades = this.all(`SELECT * FROM trades WHERE token = ? ORDER BY block_time DESC LIMIT 100`, address).map(tradeFromRow);
    const hourly = this.all(`SELECT buys, fresh_buys, whale_buys, volume_hype FROM token_hourly WHERE token = ? AND hour >= ?`, address, Math.floor(this.now() / 1000) - 86_400);
    return { row, trades, hourly };
  }
  wallet(address: string) {
    const row = this.all(`SELECT * FROM wallets WHERE address = ?`, address)[0] ?? null;
    const trades = this.all(`SELECT t.*, k.symbol AS symbol FROM trades t LEFT JOIN tokens k ON k.address = t.token WHERE t.wallet = ? ORDER BY t.block_time DESC LIMIT 100`, address).map(tradeFromRow);
    return { row, trades };
  }
  /** The newest stored buys (every buy of at least STORE_MIN_HYPE), across the chain or for one token. */
  recentBuys(filter: { token?: string | null; minHype?: number; limit: number }): TradeRow[] {
    const min = filter.minHype ?? 0;
    const rows = filter.token
      ? this.all(`SELECT t.*, k.symbol AS symbol FROM trades t LEFT JOIN tokens k ON k.address = t.token WHERE t.token = ? AND t.side = 'BUY' AND coalesce(t.amount_in_hype, 0) >= ? ORDER BY t.block_time DESC LIMIT ?`, filter.token, min, filter.limit)
      : this.all(`SELECT t.*, k.symbol AS symbol FROM trades t LEFT JOIN tokens k ON k.address = t.token WHERE t.side = 'BUY' AND coalesce(t.amount_in_hype, 0) >= ? ORDER BY t.block_time DESC LIMIT ?`, min, filter.limit);
    return rows.map(tradeFromRow);
  }
  /** Wallets funded by the same address that appear in stored rows (cluster siblings). */
  siblings(funder: string, except: string, limit: number) {
    return this.all(`SELECT address FROM wallets WHERE funded_by = ? AND address != ? LIMIT ?`, funder, except, limit).map((row) => row.address as string);
  }
  unposted(limit: number): SignalRow[] { return this.all(`SELECT s.*, t.launchpad AS token_launchpad FROM signals s LEFT JOIN tokens t ON t.address = s.token WHERE s.posted_to_telegram = 0 ORDER BY s.id ASC LIMIT ?`, limit).map(signalFromRow); }
  markPosted(ids: number[], value: 1 | 2) { for (const id of ids) this.run(`UPDATE signals SET posted_to_telegram = ? WHERE id = ?`, value, id); }
  recentSignals(limit: number): SignalRow[] { return this.all(`SELECT * FROM signals ORDER BY id DESC LIMIT ?`, limit).map(signalFromRow); }
  counts() {
    const row = this.all(`SELECT (SELECT count(*) FROM trades) AS trades, (SELECT count(*) FROM signals) AS signals, (SELECT count(*) FROM tokens) AS tokens, (SELECT count(*) FROM wallets) AS wallets`)[0];
    return { trades: Number(row?.trades ?? 0), signals: Number(row?.signals ?? 0), tokens: Number(row?.tokens ?? 0), wallets: Number(row?.wallets ?? 0) };
  }
}
