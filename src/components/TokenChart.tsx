import React, { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart } from "lightweight-charts";
import { explorerTxUrl } from "../config/chain";
import { api, type CandlePoint, type MarketBar, type MarketData } from "../lib/api";
import { INTERVAL_SECONDS, type CandleBar, type CandleInterval } from "../lib/candles";
import { ago, fmtCompact, fmtPrice, shortAddr } from "../lib/format";
import { Loom } from "./brand";

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
/** Which stored resolution each candle size is built from (the Worker keeps 1-minute bars). */
const RES_FOR: Record<CandleInterval, "1m" | "15m" | "1h"> = { "1m": "1m", "5m": "1m", "15m": "15m", "1h": "15m", "4h": "1h", "1d": "1h" };
const REFRESH_MS = 20_000;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "#12805A" with an alpha, as rgba() (the chart library parses hex and rgba only). */
function withAlpha(hex: string, a: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const n = parseInt(m, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Groups bars into `step`-second candles and scales prices by `k` (USD and/or market cap) and volume by `kv`. */
function toCandles(bars: MarketBar[], step: number, k: number, kv: number): CandleBar[] {
  const out: CandleBar[] = [];
  for (const [t0, o, h, l, c, v] of bars) {
    const t = Math.floor(t0 / step) * step;
    const cur = out[out.length - 1];
    if (cur && cur.time === t) {
      cur.high = Math.max(cur.high, h * k);
      cur.low = Math.min(cur.low, l * k);
      cur.close = c * k;
      cur.volume += v * kv;
    } else out.push({ time: t, open: o * k, high: h * k, low: l * k, close: c * k, volume: v * kv });
  }
  return out;
}

/**
 * Drops candles the chart cannot or should not draw: non-finite or non-positive values, and values more than 10,000x
 * away from the token's median close (a swap that drains a pool reports the protocol's price limit, about 3.4e38).
 * lightweight-charts throws on values that large, which used to take the whole room page down.
 */
function saneCandles<T extends { open: number; high: number; low: number; close: number }>(candles: T[]): T[] {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  const closes = candles.map((c) => c.close).filter(ok).sort((a, b) => a - b);
  if (!closes.length) return [];
  const mid = closes[Math.floor(closes.length / 2)];
  const inRange = (v: number) => ok(v) && v <= mid * 1e4 && v >= mid / 1e4;
  return candles.filter((c) => inRange(c.open) && inRange(c.high) && inRange(c.low) && inRange(c.close));
}

/**
 * Candles from the token's own pools on Elysium (GET /api/market): 1-minute bars folded from Swap logs with the chain's
 * block timestamps, the spot price from the deepest pool, and market cap from circulating supply. When the chain has no
 * trades for the token yet, the launchpad's own candle feed is shown instead and labelled as such.
 */
export function TokenChart({
  tokenAddress,
  tokenSymbol,
  hypeUsd,
  onMarket,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  decimals?: number;
  hypeUsd: number | null;
  onMarket?: (m: MarketData) => void;
}): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [interval, setIntervalState] = useState<CandleInterval>("15m");
  const [unit, setUnit] = useState<"HYPE" | "USD">("HYPE");
  const [measure, setMeasure] = useState<"price" | "mcap">("price");
  const [market, setMarket] = useState<MarketData | null>(null);
  const [fallback, setFallback] = useState<{ candles: CandlePoint[]; source: string | null } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [themeTick, setThemeTick] = useState(0);
  const [run, setRun] = useState(0);
  const onMarketRef = useRef(onMarket);
  onMarketRef.current = onMarket;

  const res = RES_FOR[interval];

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const ctrl = new AbortController();
    setState((s) => (s === "ready" ? s : "loading"));
    setError("");

    const load = async (first: boolean) => {
      try {
        const m = await api.market(tokenAddress, res, ctrl.signal);
        if (!live) return;
        setMarket(m);
        onMarketRef.current?.(m);
        if (m.bars.length < 2 && first) {
          const apiRes = interval === "4h" ? "1h" : interval;
          const fb = await api.candles(tokenAddress, apiRes).catch(() => null);
          if (live) setFallback(fb && fb.candles.length ? fb : null);
        } else if (m.bars.length >= 2) setFallback(null);
        setState("ready");
      } catch (e) {
        if (!live || ctrl.signal.aborted) return;
        if (first) {
          const apiRes = interval === "4h" ? "1h" : interval;
          const fb = await api.candles(tokenAddress, apiRes).catch(() => null);
          if (!live) return;
          if (fb && fb.candles.length) {
            setFallback(fb);
            setState("ready");
          } else {
            setError((e as Error).message);
            setState("error");
          }
        }
      } finally {
        if (live) schedule();
      }
    };
    // New trades every 20 s while the tab is visible; a hidden tab just checks again later.
    const schedule = () => {
      timer = window.setTimeout(() => (document.visibilityState === "visible" ? load(false) : schedule()), REFRESH_MS);
    };
    load(true);
    return () => {
      live = false;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [tokenAddress, res, interval, run]);

  useEffect(() => {
    const onTheme = () => setThemeTick((n) => n + 1);
    window.addEventListener("threadsium:theme", onTheme);
    return () => window.removeEventListener("threadsium:theme", onTheme);
  }, []);

  const usdRate = market?.hypeUsd ?? hypeUsd;
  const usdReady = !!usdRate && usdRate > 0;
  const effectiveUnit = unit === "USD" && usdReady ? "USD" : "HYPE";
  const usdK = effectiveUnit === "USD" ? (usdRate as number) : 1;
  const supply = market && market.circulating > 0 ? market.circulating : null;
  const effectiveMeasure = measure === "mcap" && supply ? "mcap" : "price";
  const k = usdK * (effectiveMeasure === "mcap" ? (supply as number) : 1);

  const onchain = market && market.bars.length >= 2;
  const candles = useMemo<CandleBar[]>(() => {
    const step = INTERVAL_SECONDS[interval];
    if (onchain && market) return toCandles(market.bars, step, k, usdK);
    if (!fallback) return [];
    return toCandles(
      fallback.candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume] as MarketBar),
      step,
      k,
      usdK,
    );
  }, [market, fallback, onchain, interval, k, usdK]);

  useEffect(() => {
    const el = host.current;
    if (!el || candles.length === 0) return;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const line = cssVar("--line");
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height: el.clientHeight || 300,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--muted"),
        fontFamily: "Onest Variable, system-ui, sans-serif",
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true },
      localization: {
        priceFormatter: (p: number) =>
          effectiveMeasure === "mcap" ? fmtCompact(p, 2) : p >= 1 ? p.toFixed(4) : p.toPrecision(4),
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderVisible: false,
      wickUpColor: up,
      wickDownColor: down,
      priceFormat: { type: "price", minMove: 1e-12, precision: 12 },
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const shown = saneCandles(candles);
    series.setData(shown.map((c) => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.setData(
      shown.map((c) => ({ time: c.time as never, value: c.volume, color: withAlpha(c.close >= c.open ? up : down, 0.35) })),
    );
    chart.timeScale().fitContent();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, themeTick, effectiveMeasure]);

  const spot = market?.priceHype ?? (fallback?.candles.length ? fallback.candles[fallback.candles.length - 1].close : null);
  const ref = market?.pools.find((p) => p.priced);
  const headline =
    effectiveMeasure === "mcap"
      ? market?.mcapHype
        ? effectiveUnit === "USD"
          ? `$${fmtCompact(market.mcapUsd ?? 0, 2)} MCap`
          : `${fmtCompact(market.mcapHype, 2)} HYPE MCap`
        : "No market cap yet"
      : spot
        ? effectiveUnit === "USD"
          ? fmtPrice(spot * usdK, "$")
          : `${fmtPrice(spot)} HYPE`
        : "No recent price";
  const secondary =
    effectiveMeasure === "price" && spot && usdReady
      ? effectiveUnit === "USD"
        ? `${fmtPrice(spot)} HYPE`
        : fmtPrice(spot * (usdRate as number), "$")
      : null;
  const sourceLine = onchain
    ? `Spot on ${ref?.venue ?? "its deepest pool"}${ref ? ` · ${fmtCompact(ref.depthHype, 1)} HYPE deep` : ""}${market && !market.coverage.complete ? " · loading older trades" : ""}`
    : fallback
      ? `No on-chain trades read yet · candles from ${fallback.source ?? "the launchpad"}`
      : "From the token's pools on Elysium";

  return (
    <section className="chart" aria-label={`${tokenSymbol} ${effectiveMeasure === "mcap" ? "market cap" : "price"} chart from on-chain swaps`}>
      <div className="chart-bar">
        <div className="chart-price">
          <strong>
            {headline}
            {secondary ? <small className="chart-price-alt"> {secondary}</small> : null}
          </strong>
          <span>{sourceLine}</span>
        </div>
        <div className="chart-controls">
          <div className="segmented" role="group" aria-label="Candle size">
            {INTERVALS.map((iv) => (
              <button key={iv} type="button" aria-pressed={interval === iv} className={interval === iv ? "is-on" : ""} onClick={() => setIntervalState(iv)}>
                {iv}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Chart shows">
            <button type="button" aria-pressed={effectiveMeasure === "price"} className={effectiveMeasure === "price" ? "is-on" : ""} onClick={() => setMeasure("price")}>
              Price
            </button>
            <button
              type="button"
              aria-pressed={effectiveMeasure === "mcap"}
              className={effectiveMeasure === "mcap" ? "is-on" : ""}
              disabled={!supply}
              title={supply ? undefined : "The supply could not be read from the chain"}
              onClick={() => setMeasure("mcap")}
            >
              MCap
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Unit">
            <button type="button" aria-pressed={effectiveUnit === "HYPE"} className={effectiveUnit === "HYPE" ? "is-on" : ""} onClick={() => setUnit("HYPE")}>
              HYPE
            </button>
            <button
              type="button"
              aria-pressed={effectiveUnit === "USD"}
              className={effectiveUnit === "USD" ? "is-on" : ""}
              disabled={!usdReady}
              title={usdReady ? undefined : "The HYPE/USD price is unavailable right now"}
              onClick={() => setUnit("USD")}
            >
              USD
            </button>
          </div>
        </div>
      </div>

      {state === "loading" ? (
        <div className="chart-host chart-host-center">
          <Loom label={`Reading ${tokenSymbol} trades from the chain`} detail="Finding its pools and folding their Swap events into candles" />
        </div>
      ) : state === "error" ? (
        <div className="chart-host chart-host-center">
          <div className="notice notice-error" role="alert">
            <p>The chart could not be built: {error}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setRun((n) => n + 1)}>
              Try again
            </button>
          </div>
        </div>
      ) : candles.length === 0 ? (
        <div className="chart-host chart-host-center">
          <div className="empty">
            <p>
              <strong>{market && market.pools.length === 0 ? "No HYPE pool for this token yet." : "No trades in the history read so far."}</strong>
            </p>
            <p>
              {market && market.pools.length === 0
                ? "Tokens still on a launchpad bonding curve get a chart once they trade in a V3 or V4 pool."
                : "Candles appear here as soon as this token trades against HYPE."}
            </p>
          </div>
        </div>
      ) : (
        <div ref={host} className="chart-host" />
      )}

      {market && market.swaps.length > 0 ? (
        <div className="swaps">
          <h3>Latest swaps</h3>
          <div className="table-scroll" role="region" aria-label="Latest swaps table, scrolls sideways on small screens" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Price ({effectiveUnit})</th>
                  <th scope="col">Size ({effectiveUnit})</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Age</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {market.swaps.slice(0, 10).map((s) => (
                  <tr key={`${s.tx}-${s.logIndex}`}>
                    <td className={s.side === "buy" ? "is-up" : "is-down"}>{s.side === "buy" ? "Buy" : "Sell"}</td>
                    <td className="num">{fmtPrice(s.priceHype * usdK, effectiveUnit === "USD" ? "$" : "")}</td>
                    <td className="num">{effectiveUnit === "USD" ? `$${(s.hype * usdK).toFixed(2)}` : s.hype.toFixed(3)}</td>
                    <td>{s.venue}</td>
                    <td>{ago(s.t * 1000)}</td>
                    <td>
                      <a href={explorerTxUrl(s.tx)} target="_blank" rel="noopener noreferrer" className="mono">
                        {shortAddr(s.tx, 6, 4)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
