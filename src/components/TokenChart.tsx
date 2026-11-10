import React, { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, ColorType } from "lightweight-charts";
import { CandleInterval, SwapSample, buildCandles } from "../lib/candles";
import { fetchTokenSwapSamples } from "../lib/swapFeed";
import { explorerTxUrl } from "../config/chain";
import { fmtPrice, shortAddr, timeAgo } from "../lib/format";
import { SpoolLoader } from "./brand";

const INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export function TokenChart({
  tokenAddress,
  tokenSymbol,
  decimals = 18,
  hypeUsd = 38.5,
  fallbackPriceHype = null,
}: {
  tokenAddress: string;
  tokenSymbol: string;
  decimals?: number;
  hypeUsd?: number;
  fallbackPriceHype?: number | null;
}): React.ReactElement {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [interval, setIntervalState] = useState<CandleInterval>("15m");
  const [unit, setUnit] = useState<"HYPE" | "USD">("HYPE");
  const [samples, setSamples] = useState<SwapSample[]>([]);
  const [venues, setVenues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSwaps = () => {
    setLoading(true);
    setError(null);
    fetchTokenSwapSamples(tokenAddress, decimals)
      .then((res) => {
        setSamples(res.samples);
        setVenues(res.activeVenues);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to index Swap logs");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSwaps();
  }, [tokenAddress, decimals]);

  const multiplier = unit === "USD" ? hypeUsd : 1;
  const candles = buildCandles(samples, interval, multiplier);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el || candles.length === 0) return;

    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";

    const chart = createChart(el, {
      width: el.clientWidth || 640,
      height: 300,
      layout: {
        background: {
          type: ColorType.Solid,
          color: isLight ? "#EFECE2" : "#0E1412",
        },
        textColor: isLight ? "#3E4A44" : "#9BA8A1",
      },
      grid: {
        vertLines: { color: isLight ? "#DFD9C8" : "#18221E" },
        horzLines: { color: isLight ? "#DFD9C8" : "#18221E" },
      },
      rightPriceScale: {
        borderColor: isLight ? "#D2CBB8" : "#1E2A25",
      },
      timeScale: {
        borderColor: isLight ? "#D2CBB8" : "#1E2A25",
        timeVisible: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#32D79B",
      downColor: "#F43F5E",
      borderVisible: false,
      wickUpColor: "#32D79B",
      wickDownColor: "#F43F5E",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#32D79B",
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as any,
        value: c.volume,
        color:
          c.close >= c.open
            ? "rgba(50, 215, 155, 0.28)"
            : "rgba(244, 63, 94, 0.28)",
      }))
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, unit, interval]);

  const latestSwapPrice =
    samples.length > 0
      ? samples[samples.length - 1].priceHype
      : fallbackPriceHype;

  return (
    <section className="token-chart-card" aria-label={`${tokenSymbol} on-chain chart`}>
      <div className="token-chart-toolbar">
        <div className="token-chart-meta">
          <span className="chart-pair-title">
            ${tokenSymbol} / {unit}
          </span>
          <span className="chart-pair-price">
            {latestSwapPrice
              ? fmtPrice(
                  latestSwapPrice * multiplier,
                  unit === "USD" ? "$" : ""
                ) + (unit === "HYPE" ? " HYPE" : "")
              : "Spot indexed from pool reserves"}
          </span>
          {venues.length > 0 && (
            <span className="badge badge-subtle">
              Venues: {venues.join(", ")}
            </span>
          )}
        </div>

        <div className="token-chart-controls">
          <div className="segmented-group" role="group" aria-label="Candle interval">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                className={`seg-btn ${interval === iv ? "is-active" : ""}`}
                onClick={() => setIntervalState(iv)}
              >
                {iv}
              </button>
            ))}
          </div>

          <div className="segmented-group" role="group" aria-label="Quote unit">
            <button
              type="button"
              className={`seg-btn ${unit === "HYPE" ? "is-active" : ""}`}
              onClick={() => setUnit("HYPE")}
            >
              HYPE
            </button>
            <button
              type="button"
              className={`seg-btn ${unit === "USD" ? "is-active" : ""}`}
              onClick={() => setUnit("USD")}
            >
              USD
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <SpoolLoader
          compact
          stage={{
            label: `Scanning Elysium 99901 V3 & V4 Swap logs for $${tokenSymbol}`,
            detail: "Reading PoolCreated, Initialize, and Swap topics across 13 verified contracts…",
            progress: 68,
          }}
        />
      ) : candles.length === 0 ? (
        <div className="chart-empty-state">
          <p className="font-semibold">
            No recent Swap events in the last ~9,500 blocks for ${tokenSymbol}
          </p>
          <p className="muted-note">
            {fallbackPriceHype
              ? `Current pool reserve implied spot: ${fmtPrice(fallbackPriceHype)} HYPE (${fmtPrice(
                  fallbackPriceHype * hypeUsd,
                  "$"
                )}). New swaps on BOXA, Kleos, ELYXA, ElysPump, or Shared V4 will appear here automatically.`
              : "This token is registered on Elysium 99901. Once trades execute on V3 or V4 pools, candles render directly from on-chain logs."}
          </p>
          {error && (
            <button type="button" className="btn btn-secondary btn-xs" onClick={loadSwaps}>
              Retry RPC Scan
            </button>
          )}
        </div>
      ) : (
        <div ref={chartContainerRef} className="chart-canvas-host" />
      )}

      {samples.length > 0 && (
        <div className="recent-swaps-box">
          <div className="recent-swaps-header">
            <span>Recent On-Chain Swaps ({samples.length})</span>
            <span className="muted-note">Direct from Elysium 99901 logs</span>
          </div>
          <div className="table-scroll">
            <table className="swaps-table">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Price ({unit})</th>
                  <th>Size (WHYPE)</th>
                  <th>Venue</th>
                  <th>Age</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {samples
                  .slice(-8)
                  .reverse()
                  .map((s, idx) => (
                    <tr key={`${s.txHash}-${idx}`}>
                      <td>
                        <span
                          className={`badge ${
                            s.side === "buy" ? "badge-emerald" : "badge-rose"
                          }`}
                        >
                          {s.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="font-mono">
                        {fmtPrice(
                          s.priceHype * multiplier,
                          unit === "USD" ? "$" : ""
                        )}
                      </td>
                      <td className="font-mono">{s.volumeWhype.toFixed(3)}</td>
                      <td>{s.venue}</td>
                      <td>{timeAgo(new Date(s.timestamp * 1000).toISOString())}</td>
                      <td>
                        <a
                          href={explorerTxUrl(s.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-ext-link"
                        >
                          {shortAddr(s.txHash, 6, 4)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
