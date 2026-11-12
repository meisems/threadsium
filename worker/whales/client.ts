// A small read-only JSON-RPC client: batched requests split to the endpoint's batch limit, per-request timeout,
// failover to the next endpoint, and retry with backoff for items refused by rate limits. Every HTTP attempt draws on
// a Budget, because a Cloudflare Workers Free invocation may make at most 50 subrequests.

export type RpcRequest = { method: string; params: unknown[] };
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: string; kind: RpcErrorKind };
export type RpcErrorKind = "rate" | "state" | "range" | "other";

const READ_ONLY = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_call", "eth_getCode",
  "eth_getBalance", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
]);

export interface Probe { index: number; host: string; head: number | null; ms: number; error: string | null }

export class BudgetExhausted extends Error { constructor() { super("Subrequest budget for this invocation is used up."); } }
export class Budget {
  used = 0;
  readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  get left() { return Math.max(0, this.limit - this.used); }
  take() { if (this.used >= this.limit) throw new BudgetExhausted(); this.used++; }
}

export function errorKind(message: string): RpcErrorKind {
  const text = message.toLowerCase();
  if (/rate limit|capacity|too many|429|exceeded your/.test(text)) return "rate";
  if (/missing trie node|state .* not available|header not found|pruned|historical state/.test(text)) return "state";
  if (/block range|too many (logs|results)|limit exceeded|query returned more than|range/.test(text)) return "range";
  return "other";
}

export interface RpcOptions {
  batchMax?: number;
  timeoutMs?: number;
  retries?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  budget?: Budget;
}

export class Rpc {
  readonly endpoints: string[];
  budget: Budget;
  httpRequests = 0;
  private preferred = 0;
  /** Seconds the endpoint asked us to wait (Retry-After on HTTP 429), for the caller's backoff. */
  retryAfterSec = 0;
  /** Request-level failovers (the endpoint in use refused or failed and a later one answered), for /health. */
  failovers = 0;
  lastFailover: { at: number; from: string; to: string; reason: string; methods: string } | null = null;
  /** When each endpoint last failed a request (refused, HTTP error, timeout, network), by index. */
  readonly failedAt = new Map<number, number>();
  private readonly batchMax: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(endpoints: string[], options: RpcOptions = {}) {
    if (!endpoints.length) throw new Error("No RPC endpoint configured.");
    this.endpoints = endpoints;
    this.batchMax = options.batchMax ?? 20;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    const base = options.fetcher ?? fetch;
    // Never store fetch bare: Workers throw "Illegal invocation" when it is called as a method.
    this.fetcher = (input, init) => base(input, init);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.budget = options.budget ?? new Budget(Number.MAX_SAFE_INTEGER);
  }

  /** The host currently answering, for logs and /health. */
  get endpointHost() { try { return new URL(this.endpoints[this.preferred]).host; } catch { return "?"; } }

  /** Index of the endpoint requests go to first. */
  get preferredIndex() { return this.preferred; }
  /** Host of any endpoint, for logs and /health (never the full URL: a provider URL can carry a key). */
  hostOf(index: number) { try { return new URL(this.endpoints[index]).host; } catch { return "?"; } }
  /** Send requests to this endpoint first from now on (the watchdog's switch). */
  use(index: number) { if (index >= 0 && index < this.endpoints.length) this.preferred = index; }

  /** Asks every endpoint for its latest block at once (one subrequest each). Never throws for an endpoint's failure. */
  async probe(timeoutMs = 4000): Promise<Probe[]> {
    return Promise.all(this.endpoints.map(async (url, index): Promise<Probe> => {
      const started = Date.now();
      try {
        this.budget.take(); this.httpRequests++;
        const response = await this.fetcher(url, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return { index, host: this.hostOf(index), head: null, ms: Date.now() - started, error: `HTTP ${response.status}` };
        const body = await response.json() as { result?: string; error?: { message?: string } };
        if (typeof body.result !== "string") return { index, host: this.hostOf(index), head: null, ms: Date.now() - started, error: (body.error?.message ?? "no result").slice(0, 80) };
        return { index, host: this.hostOf(index), head: Number(BigInt(body.result)), ms: Date.now() - started, error: null };
      } catch (error) {
        if (error instanceof BudgetExhausted) return { index, host: this.hostOf(index), head: null, ms: 0, error: "skipped: request budget" };
        return { index, host: this.hostOf(index), head: null, ms: Date.now() - started, error: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error" };
      }
    }));
  }

  /** Several reads; each item succeeds or fails on its own. Throws only when no endpoint answers at all. */
  async batch<T = unknown>(requests: RpcRequest[]): Promise<RpcResult<T>[]> {
    for (const request of requests) if (!READ_ONLY.has(request.method)) throw new Error(`Not a read-only method: ${request.method}`);
    const results: RpcResult<T>[] = new Array(requests.length);
    for (let start = 0; start < requests.length; start += this.batchMax) {
      const indexes = requests.slice(start, start + this.batchMax).map((_, offset) => start + offset);
      let pending = indexes;
      for (let attempt = 0; attempt <= this.retries && pending.length; attempt++) {
        if (attempt > 0) await this.sleep(300 * 3 ** (attempt - 1));
        const answers = await this.send<T>(pending.map((index) => requests[index]));
        const retry: number[] = [];
        answers.forEach((answer, offset) => {
          const index = pending[offset];
          results[index] = answer;
          if (!answer.ok && answer.kind === "rate") retry.push(index);
        });
        pending = retry;
      }
      // Items refused for missing historical state are asked of the other endpoints, which may keep more history.
      for (let shift = 1; shift < this.endpoints.length; shift++) {
        const missing = indexes.filter((index) => { const result = results[index]; return result && !result.ok && result.kind === "state"; });
        if (!missing.length) break;
        const answers = await this.send<T>(missing.map((index) => requests[index]), (this.preferred + shift) % this.endpoints.length, false).catch(() => null);
        answers?.forEach((answer, offset) => { if (answer.ok || answer.kind !== "state") results[missing[offset]] = answer; });
      }
    }
    return results;
  }

  async call<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const [result] = await this.batch<T>([{ method, params }]);
    if (!result.ok) throw Object.assign(new Error(result.error), { kind: result.kind });
    return result.value;
  }

  private async send<T>(requests: RpcRequest[], start = this.preferred, sticky = true): Promise<RpcResult<T>[]> {
    let last = "no endpoint answered";
    for (let tried = 0; tried < this.endpoints.length; tried++) {
      const index = (start + tried) % this.endpoints.length;
      this.budget.take();
      this.httpRequests++;
      try {
        const body = requests.length === 1
          ? JSON.stringify({ jsonrpc: "2.0", id: 0, ...requests[0] })
          : JSON.stringify(requests.map((request, id) => ({ jsonrpc: "2.0", id, ...request })));
        const response = await this.fetcher(this.endpoints[index], {
          method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 429) {
          last = "HTTP 429"; this.failedAt.set(index, Date.now());
          const wait = Number(response.headers.get("retry-after"));
          this.retryAfterSec = Number.isFinite(wait) && wait > 0 ? Math.min(300, wait) : 0;
          continue;
        }
        if (!response.ok) { last = `HTTP ${response.status}`; this.failedAt.set(index, Date.now()); continue; }
        const parsed = await response.json() as unknown;
        const list = (Array.isArray(parsed) ? parsed : [parsed]) as { id: number | null; result?: T; error?: { message?: string } }[];
        if (list.length === 1 && list[0].id === null && list[0].error && requests.length > 1) { last = list[0].error.message ?? "batch refused"; this.failedAt.set(index, Date.now()); continue; }
        const byId = new Map(list.map((item) => [item.id, item]));
        const answers = requests.map((_, id): RpcResult<T> => {
          const item = byId.get(id);
          if (item && item.error === undefined && "result" in item) return { ok: true, value: item.result as T };
          const message = (item?.error?.message ?? "no answer").slice(0, 200);
          return { ok: false, error: message, kind: errorKind(message) };
        });
        // An endpoint that refuses every item for rate limits is skipped for the rest of this call.
        if (answers.every((answer) => !answer.ok && answer.kind === "rate") && tried < this.endpoints.length - 1) { last = "rate limited"; this.failedAt.set(index, Date.now()); continue; }
        // Move the preference only on a real failover, and only if nobody (the watchdog) switched endpoints while this
        // request was in flight: a late answer from the old endpoint must not undo a switch.
        if (sticky && index !== start && this.preferred === start) {
          this.failovers++;
          this.lastFailover = { at: Date.now(), from: this.hostOf(start), to: this.hostOf(index), reason: last, methods: [...new Set(requests.map((request) => request.method))].join(",") + ` x${requests.length}` };
          this.preferred = index;
        }
        return answers;
      } catch (error) {
        if (error instanceof BudgetExhausted) throw error;
        const cause = (error as { cause?: { code?: string } }).cause?.code;
        last = error instanceof Error && error.name === "TimeoutError" ? "timed out" : `network error${cause ? ` ${cause}` : ""}`;
        this.failedAt.set(index, Date.now());
      }
    }
    throw Object.assign(new Error(`RPC failed on every endpoint (${last}).`), { kind: /429|rate/i.test(last) ? "rate" : "other" });
  }
}

export const toHex = (value: number | bigint) => `0x${BigInt(value).toString(16)}` as const;
export const hexToNumber = (value: string | null | undefined): number => (value ? Number(BigInt(value)) : 0);
