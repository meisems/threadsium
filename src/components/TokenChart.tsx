import React, { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, HistogramSeries, createChart } from "lightweight-charts";
import { explorerTxUrl } from "../config/chain";
import { buildCandles, type CandleInterval, type SwapSample } from "../lib/candles";
import { ago, fmtPrice, shortAddr } from "../lib/format";
import { fetchTokenSwapSamples } from "../lib/swapFeed";
import { Loom } from "./brand";

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

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

/** Candles built in the browser from the token's own Swap logs on Elysium's V3 and V4 pools. */
export function TokenChart({
  tokenAddress,
  tokenSymbol,
  decimals = 18,
  hypeUsd,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  decimals?: number;
  hypeUsd: number | null;
}): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [interval, setIntervalState] = useState<CandleInterval>("15m");
  const [unit, setUnit] = useState<"HYPE" | "USD">("HYPE");
  const [samples, setSamples] = useState<SwapSample[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [themeTick, setThemeTick] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    setState("loading");
    setError("");
    fetchTokenSwapSamples(tokenAddress, decimals)
      .then((res) => {
        if (!live) return;
        setSamples(res.samples);
        setVenues(res.activeVenues);
        setState("ready");
      })
      .catch((err) => {
        if (!live) return;
        setError(err instanceof Error ? err.message : "The swap logs could not be read.");
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [tokenAddress, decimals, run]);

  useEffect(() => {
    const onTheme = () => setThemeTick((n) => n + 1);
    window.addEventListener("threadsium:theme", onTheme);
    return () => window.removeEventListener("threadsium:theme", onTheme);
  }, []);

  const usdReady = !!hypeUsd && hypeUsd > 0;
  const effectiveUnit = unit === "USD" && usdReady ? "USD" : "HYPE";
  const multiplier = effectiveUnit === "USD" ? (hypeUsd as number) : 1;
  const candles = useMemo(() => buildCandles(samples, interval, multiplier), [samples, interval, multiplier]);

  useEffect(() => {
    const el = host.current;
    if (!el || candles.length === 0) return;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const line = cssVar("--line");
    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height: el.clientHeight || 300,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--muted"), fontFamily: "Onest Variable, system-ui, sans-serif" },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    series.setData(candles.map((c) => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.setData(candles.map((c) => ({ time: c.time as never, value: c.volume, color: withAlpha(c.close >= c.open ? up : down, 0.35) })));
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
  }, [candles, themeTick]);

  const last = samples.length ? samples[samples.length - 1].priceHype : null;

  return (
    <section className="chart" aria-label={`${tokenSymbol} price chart from on-chain swaps`}>
      <div className="chart-bar">
        <div className="chart-price">
          <strong>{last ? `${fmtPrice(last * multiplier, effectiveUnit === "USD" ? "$" : "")}${effectiveUnit === "HYPE" ? " HYPE" : ""}` : "No recent price"}</strong>
          <span>{venues.length ? `Last swap, from ${venues.join(", ")}` : "per token, from the last swap"}</span>
        </div>
        <div className="chart-controls">
          <div className="segmented" role="group" aria-label="Candle size">
            {INTERVALS.map((iv) => (
              <button key={iv} type="button" aria-pressed={interval === iv} className={interval === iv ? "is-on" : ""} onClick={() => setIntervalState(iv)}>
                {iv}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Price unit">
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
          <Loom label={`Reading ${tokenSymbol} swaps from the chain`} detail="Scanning V3 and V4 pool logs on Elysium" />
        </div>
      ) : state === "error" ? (
        <div className="chart-host chart-host-center">
          <div className="notice notice-error" role="alert">
            <p>The chart could not be built: {error}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setRun((n) => n + 1)}>
              Read the logs again
            </button>
          </div>
        </div>
      ) : candles.length === 0 ? (
        <div className="chart-host chart-host-center">
          <div className="empty">
            <p>
              <strong>No swaps in the recent block range.</strong>
            </p>
            <p>Candles appear here as soon as this token trades against HYPE on a V3 or V4 pool.</p>
          </div>
        </div>
      ) : (
        <div ref={host} className="chart-host" />
      )}

      {samples.length > 0 ? (
        <div className="swaps">
          <h3>Latest swaps</h3>
          <div className="table-scroll" role="region" aria-label="Latest swaps table, scrolls sideways on small screens" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Price ({effectiveUnit})</th>
                  <th scope="col">Size (HYPE)</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Age</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {samples
                  .slice(-8)
                  .reverse()
                  .map((s, i) => (
                    <tr key={`${s.txHash}-${i}`}>
                      <td className={s.side === "buy" ? "is-up" : "is-down"}>{s.side === "buy" ? "Buy" : "Sell"}</td>
                      <td className="num">{fmtPrice(s.priceHype * multiplier, effectiveUnit === "USD" ? "$" : "")}</td>
                      <td className="num">{s.volumeWhype.toFixed(3)}</td>
                      <td>{s.venue}</td>
                      <td>{ago(s.timestamp * 1000)}</td>
                      <td>
                        <a href={explorerTxUrl(s.txHash)} target="_blank" rel="noopener noreferrer" className="mono">
                          {shortAddr(s.txHash, 6, 4)}
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
