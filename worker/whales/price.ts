// HYPE in US dollars from Hyperliquid's public info API: POST https://api.hyperliquid.xyz/info {"type":"allMids"}
// returns an object of mid prices as strings; the "HYPE" key is the HYPE mid (checked 9 November 2026: "77.0595").
// Cached for 30 s. Any failure returns the last good price while it is under 10 minutes old, then null, and the UI
// shows HYPE only.

export interface Price { usd: number; at: number }

export class HypePrice {
  private last: Price | null = null;
  private inflight: Promise<Price | null> | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now) { this.fetcher = fetcher; this.now = now; }

  /** A pinned price for replays and tests. */
  static fixed(usd: number | null): HypePrice {
    const price = new HypePrice(async () => new Response("{}"));
    price.last = usd === null ? null : { usd, at: Number.MAX_SAFE_INTEGER };
    return price;
  }

  current(): number | null {
    return this.last && this.now() - this.last.at < 10 * 60_000 ? this.last.usd : null;
  }

  async refresh(): Promise<number | null> {
    if (this.last && this.now() - this.last.at < 30_000) return this.last.usd;
    // Requests that arrive together share one fetch.
    this.inflight ??= (async () => {
      try {
        const response = await this.fetcher("https://api.hyperliquid.xyz/info", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids" }), signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return null;
        const body = await response.json() as Record<string, unknown>;
        const usd = typeof body.HYPE === "string" ? Number(body.HYPE) : NaN;
        if (!Number.isFinite(usd) || usd <= 0 || usd > 100_000) return null;
        this.last = { usd, at: this.now() };
        return this.last;
      } catch { return null; } finally { this.inflight = null; }
    })();
    await this.inflight;
    return this.current();
  }
}
