import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeSwap, foldBars, hypeDepthFromLiquidity, marketCaps, priceFromSqrt, resample, type Bar, type PoolRef, type SwapPoint } from "../worker/marketCore.ts";

const Q96 = 2 ** 96;
/** sqrtPriceX96 for a raw currency1-per-currency0 ratio. */
const sqrtOf = (raw1per0: number) => BigInt(Math.round(Math.sqrt(raw1per0) * Q96));
const word = (v: bigint) => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, "0");
const close = (a: number, b: number, rel = 1e-9) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${a} ≉ ${b}`);

const v4Native: PoolRef = { kind: "v4", address: "0xmgr", id: "0xid", hypeIsC0: true, venue: "BOXA", hypeToken: "0x0" };
const v3TokenFirst: PoolRef = { kind: "v3", address: "0xpool", id: "0xpool", hypeIsC0: false, venue: "Ronspad V3", hypeToken: "0xwhype" };

function swapLog(a0: bigint, a1: bigint, sqrt: bigint, t = 1_794_410_000, block = 100, logIndex = 0) {
  return {
    data: `0x${word(a0)}${word(a1)}${word(sqrt)}${word(0n)}`,
    blockNumber: `0x${block.toString(16)}`,
    logIndex: `0x${logIndex.toString(16)}`,
    transactionHash: `0x${"ab".repeat(32)}`,
    blockTimestamp: `0x${t.toString(16)}`,
  };
}

describe("Market maths from pool state", () => {
  it("prices a token in HYPE from sqrtPriceX96 whichever side HYPE is on, with the token's decimals", () => {
    // HELIOS-style: native HYPE is currency0, token currency1, 18 decimals, 2.4e-6 HYPE per token.
    close(priceFromSqrt(sqrtOf(1 / 2.4e-6), true, 18), 2.4e-6, 1e-9);
    // Token is currency0 with 6 decimals, WHYPE currency1: 0.5 HYPE per token is 0.5e12 raw WHYPE per raw token.
    close(priceFromSqrt(sqrtOf(0.5 * 1e12), false, 6), 0.5, 1e-9);
    assert.equal(priceFromSqrt(0n, true, 18), 0);
  });

  it("measures the HYPE side of in-range liquidity", () => {
    const sqrt = BigInt(2 * Q96); // sqrtP = 2
    assert.equal(hypeDepthFromLiquidity(10n ** 21n, sqrt, true), 500); // x = L / sqrtP
    assert.equal(hypeDepthFromLiquidity(10n ** 21n, sqrt, false), 2000); // y = L * sqrtP
  });

  it("reads V4 deltas as the swapper's and V3 amounts as the pool's, so a buy is HYPE going into the pool either way", () => {
    const sqrt = sqrtOf(1 / 2.4e-6);
    const buy4 = decodeSwap(swapLog(-(10n ** 18n), 400_000n * 10n ** 18n, sqrt), v4Native, 18, true)!;
    assert.equal(buy4.side, "buy");
    assert.equal(buy4.hype, 1);
    assert.equal(buy4.t, 1_794_410_000);
    const sell4 = decodeSwap(swapLog(2n * 10n ** 18n, -(800_000n * 10n ** 18n), sqrt), v4Native, 18, true)!;
    assert.equal(sell4.side, "sell");
    assert.equal(sell4.hype, 2);

    const s3 = sqrtOf(0.5);
    assert.equal(decodeSwap(swapLog(-(10n ** 18n), 5n * 10n ** 17n, s3), v3TokenFirst, 18, true)!.side, "buy"); // pool got WHYPE (token1)
    assert.equal(decodeSwap(swapLog(10n ** 18n, -(5n * 10n ** 17n), s3), v3TokenFirst, 18, true)!.side, "sell");
    // A log without a block timestamp cannot be placed on the chart.
    const noTime = { ...swapLog(-(10n ** 18n), 1n, sqrt), blockTimestamp: undefined };
    assert.equal(decodeSwap(noTime, v4Native, 18, true), null);
  });

  it("counts a swap that drains a pool to the sqrtPrice limit as volume only, never as a price", () => {
    // TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE: a drained pool reports ~3.4e38 or ~2.9e-39 HYPE per token.
    const MIN = 4295128739n;
    const MAX = 1461446703485210103287273052203988822378723970342n;
    for (const sqrt of [MIN, MIN + 1n, MAX - 1n, MAX]) {
      for (const pool of [v4Native, v3TokenFirst]) {
        const s = decodeSwap(swapLog(-(10n ** 18n), 10n ** 18n, sqrt), pool, 18, true);
        assert.ok(s, `swap at sqrtP ${sqrt} on ${pool.kind} should still be decoded`);
        assert.equal(s.priced, false, `sqrtP ${sqrt} on ${pool.kind} must not price a candle`);
        assert.equal(s.hype, 1);
      }
    }
    // Just inside the limits, and at a normal price, the swap still prices the chart.
    assert.equal(decodeSwap(swapLog(-(10n ** 18n), 1n, MIN + 2n), v4Native, 18, true)!.priced, true);
    assert.equal(decodeSwap(swapLog(-(10n ** 18n), 1n, MAX - 2n), v4Native, 18, true)!.priced, true);
    assert.equal(decodeSwap(swapLog(-(10n ** 18n), 1n, sqrtOf(1 / 2.4e-6)), v4Native, 18, true)!.priced, true);
    // A thin pool stays unpriced whatever its sqrtPrice.
    assert.equal(decodeSwap(swapLog(-(10n ** 18n), 1n, sqrtOf(1 / 2.4e-6)), v4Native, 18, false)!.priced, false);

    // Folded into bars, the drained-pool swap adds volume but leaves the minute's high, low and close alone.
    const normal = decodeSwap(swapLog(-(10n ** 18n), 1n, sqrtOf(1 / 2.4e-6), 1_794_410_400, 100, 0), v4Native, 18, true)!;
    const drained = decodeSwap(swapLog(-(10n ** 18n), 1n, MIN, 1_794_410_410, 100, 1), v4Native, 18, true)!;
    const [bar] = foldBars([], [normal, drained], "append");
    close(bar[2], 2.4e-6, 1e-9);
    close(bar[3], 2.4e-6, 1e-9);
    close(bar[4], 2.4e-6, 1e-9);
    assert.equal(bar[5], 2);
  });
});

describe("One-minute bars", () => {
  const pt = (t: number, price: number, hype: number, priced = true, block = t): SwapPoint => ({
    t,
    block,
    logIndex: 0,
    priceHype: price,
    hype,
    side: "buy",
    tx: "0x",
    venue: "x",
    priced,
  });

  it("folds swaps into OHLCV minutes and joins the boundary minute when new swaps arrive", () => {
    let bars: Bar[] = foldBars([], [pt(60, 1, 1), pt(70, 3, 1), pt(80, 2, 1), pt(130, 4, 2)], "append");
    assert.deepEqual(bars, [
      [60, 1, 3, 1, 2, 3],
      [120, 4, 4, 4, 4, 2],
    ]);
    bars = foldBars(bars, [pt(150, 5, 1), pt(200, 6, 1)], "append");
    assert.deepEqual(bars, [
      [60, 1, 3, 1, 2, 3],
      [120, 4, 5, 4, 5, 3],
      [180, 6, 6, 6, 6, 1],
    ]);
  });

  it("prepends older history, keeping the newer minute's close and the older minute's open", () => {
    const bars: Bar[] = [[120, 4, 4, 4, 4, 2]];
    assert.deepEqual(foldBars(bars, [pt(10, 1, 1), pt(125, 7, 1)], "prepend"), [
      [0, 1, 1, 1, 1, 1],
      [120, 7, 7, 4, 4, 3],
    ]);
  });

  it("counts thin-pool swaps as volume without moving the price", () => {
    const bars = foldBars([[0, 2, 2, 2, 2, 1]], [pt(30, 99, 5, false), pt(65, 50, 1, false)], "append");
    assert.deepEqual(bars, [
      [0, 2, 2, 2, 2, 6],
      [60, 2, 2, 2, 2, 1],
    ]);
  });

  it("resamples minutes into larger candles", () => {
    const m: Bar[] = [
      [0, 1, 2, 1, 2, 1],
      [60, 2, 5, 2, 3, 1],
      [900, 3, 3, 1, 1, 4],
    ];
    assert.deepEqual(resample(m, 900), [
      [0, 1, 5, 1, 3, 2],
      [900, 3, 3, 1, 1, 4],
    ]);
  });
});

describe("Market cap", () => {
  it("uses circulating supply (total minus dead and zero balances) for market cap and total supply for FDV", () => {
    const e18 = 10n ** 18n;
    const c = marketCaps(2e-6, { totalSupply: 1_000_000_000n * e18, burned: 20_000_000n * e18, decimals: 18 }, 70);
    assert.equal(c.circulating, 980_000_000);
    close(c.mcapHype!, 1960);
    close(c.mcapUsd!, 137_200);
    close(c.fdvHype!, 2000);
    close(c.priceUsd!, 1.4e-4);
  });

  it("gives no USD figures without a HYPE price and no market cap without a token price", () => {
    const c = marketCaps(null, { totalSupply: 10n ** 24n, burned: 0n, decimals: 18 }, null);
    assert.equal(c.mcapHype, null);
    assert.equal(c.mcapUsd, null);
    assert.equal(marketCaps(1, { totalSupply: 10n ** 24n, burned: 0n, decimals: 18 }, null).mcapUsd, null);
  });
});
