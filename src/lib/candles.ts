export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const INTERVAL_SECONDS: Record<CandleInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export interface SwapSample {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
  priceHype: number;
  volumeWhype: number;
  side: "buy" | "sell";
  venue: string;
}

export interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function buildCandles(
  samples: SwapSample[],
  interval: CandleInterval,
  multiplier = 1
): CandleBar[] {
  const step = INTERVAL_SECONDS[interval] || 300;
  const valid = samples
    .filter(
      (s) =>
        Number.isFinite(s.priceHype) &&
        s.priceHype > 0 &&
        Number.isFinite(s.timestamp) &&
        s.timestamp > 0
    )
    .sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);

  if (valid.length === 0) return [];

  const buckets = new Map<number, CandleBar>();
  for (const s of valid) {
    const price = s.priceHype * multiplier;
    const vol = Math.max(0, s.volumeWhype * multiplier);
    const bucketTime = Math.floor(s.timestamp / step) * step;
    const existing = buckets.get(bucketTime);
    if (!existing) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: vol,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += vol;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
