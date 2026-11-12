// Pure maths for /api/market: pool prices and depth from Uniswap V3/V4 state, Swap log decoding, and 1-minute bars.
// No I/O here, so tests/market.test.ts can check it against hand-computed values.

export type Hex = `0x${string}`;

/** One HYPE pool of the token. `hypeIsC0`: HYPE (native or a WHYPE) is currency0/token0 and the token is currency1. */
export interface PoolRef {
  kind: "v4" | "v3";
  /** V4: the PoolManager. V3: the pool contract. */
  address: string;
  /** V4 pool id (bytes32); V3: the pool address again. */
  id: string;
  hypeIsC0: boolean;
  venue: string;
  /** V3: the venue's WHYPE (for its balance); V4 native pools: 0x0. */
  hypeToken: string;
}

export interface SwapPoint {
  /** Unix seconds from the log's blockTimestamp. */
  t: number;
  block: number;
  logIndex: number;
  /** Price after the swap, HYPE per whole token. */
  priceHype: number;
  /** HYPE that moved in the swap. */
  hype: number;
  side: "buy" | "sell";
  tx: string;
  venue: string;
  /** False for swaps in thin pools: they count toward volume but not toward the price line. */
  priced: boolean;
}

/** [time (minute start, unix s), open, high, low, close, volume in HYPE] */
export type Bar = [number, number, number, number, number, number];

const Q96 = 2 ** 96;

/** Uniswap V3/V4 sqrtPriceX96 bounds (TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE). */
const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

export function signed256(word: string): bigint {
  const v = BigInt(`0x${word || "0"}`);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

/**
 * HYPE per whole token from a pool's sqrtPriceX96. Uniswap prices are currency1 per currency0 in raw units, so the
 * decimals of both sides are applied and the ratio is inverted when HYPE is currency0.
 */
export function priceFromSqrt(sqrtPriceX96: bigint, hypeIsC0: boolean, tokenDecimals: number): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const r = Number(sqrtPriceX96) / Q96;
  const raw1per0 = r * r; // raw currency1 units per raw currency0 unit
  if (hypeIsC0) {
    // currency0 = HYPE (18), currency1 = token: tokens per HYPE = raw1per0 * 10^(18 - dec)
    const tokensPerHype = raw1per0 * 10 ** (18 - tokenDecimals);
    return tokensPerHype > 0 ? 1 / tokensPerHype : 0;
  }
  // currency0 = token, currency1 = HYPE: HYPE per token = raw1per0 * 10^(dec - 18)
  return raw1per0 * 10 ** (tokenDecimals - 18);
}

/**
 * HYPE held at the current price by in-range liquidity L (virtual reserve, in HYPE): x = L / sqrtP for currency0,
 * y = L * sqrtP for currency1. Concentrated positions make this an upper bound; it is used to rank pools and as depth.
 */
export function hypeDepthFromLiquidity(liquidity: bigint, sqrtPriceX96: bigint, hypeIsC0: boolean): number {
  if (liquidity <= 0n || sqrtPriceX96 <= 0n) return 0;
  const r = Number(sqrtPriceX96) / Q96;
  const raw = hypeIsC0 ? Number(liquidity) / r : Number(liquidity) * r;
  return raw / 1e18;
}

/**
 * Decodes a V3 or V4 Swap log of a known pool. V3 amounts are the pool's (positive: the pool received it); V4 amounts
 * are the swapper's balance delta (negative: the swapper paid it). Either way a buy is HYPE going into the pool.
 */
export function decodeSwap(
  log: { data: string; blockNumber: string; logIndex: string; transactionHash: string; blockTimestamp?: string },
  pool: PoolRef,
  tokenDecimals: number,
  priced: boolean,
): SwapPoint | null {
  const d = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
  if (d.length < 192) return null;
  const a0 = signed256(d.slice(0, 64));
  const a1 = signed256(d.slice(64, 128));
  const sqrtP = BigInt(`0x${d.slice(128, 192)}`);
  const hypeAmt = pool.hypeIsC0 ? a0 : a1;
  if (hypeAmt === 0n) return null;
  const intoPool = pool.kind === "v3" ? hypeAmt > 0n : hypeAmt < 0n;
  const priceHype = priceFromSqrt(sqrtP, pool.hypeIsC0, tokenDecimals);
  // A swap that drains a pool leaves it at the protocol's price limit (about 3.4e38 or 2.9e-39). That is not a
  // price anyone traded at, so it counts as volume only and never sets a candle's high, low or close.
  if (sqrtP <= MIN_SQRT_PRICE + 1n || sqrtP >= MAX_SQRT_PRICE - 1n) priced = false;
  const t = log.blockTimestamp ? parseInt(log.blockTimestamp, 16) : 0;
  if (!(priceHype > 0) || !Number.isFinite(priceHype) || !(t > 0)) return null;
  const abs = hypeAmt < 0n ? -hypeAmt : hypeAmt;
  return {
    t,
    block: parseInt(log.blockNumber, 16),
    logIndex: parseInt(log.logIndex, 16),
    priceHype,
    hype: Number(abs) / 1e18,
    side: intoPool ? "buy" : "sell",
    tx: log.transactionHash,
    venue: pool.venue,
    priced,
  };
}

const round = (n: number) => Number(n.toPrecision(7));

/**
 * Folds swaps into 1-minute bars. `bars` must be sorted by time and `points` must all be newer than (or inside the last
 * minute of) the bars, or all older than (or inside the first minute of) them; `side` says which end they join.
 * Unpriced swaps add volume only; a minute with only unpriced swaps carries the previous close forward.
 */
export function foldBars(bars: Bar[], points: SwapPoint[], side: "append" | "prepend"): Bar[] {
  const sorted = points.slice().sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const fresh: Bar[] = [];
  let lastClose: number | null = side === "append" && bars.length ? bars[bars.length - 1][4] : null;
  for (const p of sorted) {
    const m = Math.floor(p.t / 60) * 60;
    let bar = fresh[fresh.length - 1];
    if (!bar || bar[0] !== m) {
      const seed = p.priced ? p.priceHype : lastClose;
      if (seed === null) continue; // volume before the first known price cannot be placed
      bar = [m, seed, seed, seed, seed, 0];
      fresh.push(bar);
    }
    if (p.priced) {
      bar[2] = Math.max(bar[2], p.priceHype);
      bar[3] = Math.min(bar[3], p.priceHype);
      bar[4] = p.priceHype;
      lastClose = p.priceHype;
    }
    bar[5] += p.hype;
  }
  if (!fresh.length) return bars;
  const out = bars.slice();
  if (side === "append") {
    for (const b of fresh) {
      const last = out[out.length - 1];
      if (last && last[0] === b[0]) out[out.length - 1] = [last[0], last[1], Math.max(last[2], b[2]), Math.min(last[3], b[3]), b[4], last[5] + b[5]];
      else if (!last || b[0] > last[0]) out.push(b);
    }
  } else {
    for (let i = fresh.length - 1; i >= 0; i--) {
      const b = fresh[i];
      const first = out[0];
      if (first && first[0] === b[0]) out[0] = [first[0], b[1], Math.max(first[2], b[2]), Math.min(first[3], b[3]), first[4], first[5] + b[5]];
      else if (!first || b[0] < first[0]) out.unshift(b);
    }
  }
  return out.map((b) => [b[0], round(b[1]), round(b[2]), round(b[3]), round(b[4]), round(b[5])] as Bar);
}

/** Groups 1-minute bars into `step`-second bars (open of the first, close of the last, summed volume). */
export function resample(bars: Bar[], step: number): Bar[] {
  if (step <= 60) return bars;
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b[0] / step) * step;
    const cur = out[out.length - 1];
    if (cur && cur[0] === t) {
      cur[2] = Math.max(cur[2], b[2]);
      cur[3] = Math.min(cur[3], b[3]);
      cur[4] = b[4];
      cur[5] += b[5];
    } else out.push([t, b[1], b[2], b[3], b[4], b[5]]);
  }
  return out;
}

export interface SupplyFacts {
  totalSupply: bigint;
  burned: bigint;
  decimals: number;
}

/** Market cap on circulating supply (total minus what sits at the dead and zero addresses) and FDV on total supply. */
export function marketCaps(priceHype: number | null, s: SupplyFacts, hypeUsd: number | null) {
  const unit = 10 ** s.decimals;
  const total = Number(s.totalSupply) / unit;
  const burned = Number(s.burned > s.totalSupply ? s.totalSupply : s.burned) / unit;
  const circulating = total - burned;
  const mcapHype = priceHype && priceHype > 0 && circulating > 0 ? priceHype * circulating : null;
  const fdvHype = priceHype && priceHype > 0 && total > 0 ? priceHype * total : null;
  const usd = (v: number | null) => (v !== null && hypeUsd && hypeUsd > 0 ? v * hypeUsd : null);
  return {
    totalSupply: total,
    burned,
    circulating,
    priceUsd: usd(priceHype && priceHype > 0 ? priceHype : null),
    mcapHype,
    mcapUsd: usd(mcapHype),
    fdvHype,
    fdvUsd: usd(fdvHype),
  };
}
