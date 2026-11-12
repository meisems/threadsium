// Whale watch: every buy of 5 HYPE and up, and the four signals (whale buys, fresh wallets, accumulation, funded
// clusters), as lists for /app/whales and a compact strip for token rooms.
import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { explorerAddress, explorerTx } from "../config/chain";
import { api, type WhaleBuy, type WhaleSignal, type WhaleSignalType, type WhalesResponse } from "../lib/api";
import { ago, fmtCompact, fullTime, shortAddr } from "../lib/format";
import { TokenMark } from "./Avatar";
import { Loom } from "./brand";
import { IconExternal } from "./icons";

export const SIGNAL_LABEL: Record<WhaleSignalType, string> = {
  WHALE_BUY: "Whale buy",
  FRESH_BUY: "Fresh wallet",
  ACCUMULATION: "Accumulation",
  CLUSTER: "Cluster",
};

export const SIGNAL_RULE: Record<WhaleSignalType, (t: WhalesResponse["thresholds"]) => string> = {
  WHALE_BUY: (t) => `A single buy of at least ${t.whaleMinHype} HYPE.`,
  FRESH_BUY: (t) => `A buy of at least ${t.freshMinHype} HYPE from a wallet with ${t.freshMaxNonce} or fewer transactions.`,
  ACCUMULATION: (t) => `The same wallet buying the same token ${t.accumMinBuys}+ times within ${Math.round(t.accumWindowMin / 60)} h.`,
  CLUSTER: () => "Three or more fresh wallets funded by the same address buying the same token within 10 minutes.",
};

function SignalRow({ s, showToken }: { s: WhaleSignal; showToken: boolean }): React.ReactElement {
  const symbol = s.symbol ?? shortAddr(s.token);
  return (
    <li className={`whale-row whale-${s.type.toLowerCase()}`}>
      <span className="whale-kind">{SIGNAL_LABEL[s.type]}</span>
      <div className="whale-main">
        <div className="whale-line">
          {showToken ? (
            <Link to={`/app/token/${s.token}`} className="whale-token">
              <TokenMark address={s.token} symbol={symbol} size={20} />
              <strong>${symbol}</strong>
            </Link>
          ) : null}
          <span className="whale-amount mono">
            {s.amountHype !== null ? `${fmtCompact(s.amountHype)} HYPE` : "amount unknown"}
            {s.amountUsd !== null ? <span className="whale-usd"> ≈ ${fmtCompact(s.amountUsd)}</span> : null}
          </span>
          {s.buyCount && s.buyCount > 1 ? <span className="chip-note">{s.buyCount} buys</span> : null}
        </div>
        <div className="whale-meta">
          {s.wallet ? (
            <a href={explorerAddress(s.wallet)} target="_blank" rel="noopener noreferrer" className="mono" title={s.wallet}>
              {shortAddr(s.wallet)}
            </a>
          ) : s.clusterWallets ? (
            <span title={s.clusterWallets.join("\n")}>{s.clusterWallets.length} wallets</span>
          ) : null}
          {s.type === "CLUSTER" && s.fundedBy ? (
            <a href={explorerAddress(s.fundedBy)} target="_blank" rel="noopener noreferrer" className="mono" title={`All funded by ${s.fundedBy}`}>
              funded by {shortAddr(s.fundedBy)}
            </a>
          ) : null}
          {s.walletNonce !== null ? <span title="Transactions the wallet had sent by this buy">nonce {s.walletNonce}</span> : null}
          {s.launchpad && s.launchpad !== "unknown" ? <span>{s.launchpad}</span> : null}
          <time dateTime={new Date(s.time).toISOString()} title={fullTime(s.time)}>
            {ago(s.time)}
          </time>
          <a href={explorerTx(s.txHash)} target="_blank" rel="noopener noreferrer" className="whale-tx" aria-label={`Transaction ${shortAddr(s.txHash)} on the Elysium explorer`}>
            tx <IconExternal size={12} />
          </a>
        </div>
      </div>
    </li>
  );
}

function BuyRow({ b, showToken, hypeUsd }: { b: WhaleBuy; showToken: boolean; hypeUsd: number | null }): React.ReactElement {
  const symbol = b.symbol ?? shortAddr(b.token);
  return (
    <li className={`whale-row whale-buy${b.fresh ? " whale-buy-fresh" : ""}`}>
      <span className="whale-kind">{b.fresh ? "Fresh wallet" : "Buy"}</span>
      <div className="whale-main">
        <div className="whale-line">
          {showToken ? (
            <Link to={`/app/token/${b.token}`} className="whale-token">
              <TokenMark address={b.token} symbol={symbol} size={20} />
              <strong>${symbol}</strong>
            </Link>
          ) : null}
          <span className="whale-amount mono">
            {b.amountHype !== null ? `${fmtCompact(b.amountHype)} HYPE` : "amount unknown"}
            {b.amountHype !== null && hypeUsd ? <span className="whale-usd"> ≈ ${fmtCompact(b.amountHype * hypeUsd)}</span> : null}
          </span>
        </div>
        <div className="whale-meta">
          <a href={explorerAddress(b.wallet)} target="_blank" rel="noopener noreferrer" className="mono" title={b.wallet}>
            {shortAddr(b.wallet)}
          </a>
          {b.walletNonce !== null ? <span title="Transactions the wallet had sent by this buy">nonce {b.walletNonce}</span> : null}
          {b.launchpad && b.launchpad !== "unknown" ? <span>{b.launchpad}</span> : null}
          <time dateTime={new Date(b.time).toISOString()} title={fullTime(b.time)}>
            {ago(b.time)}
          </time>
          <a href={explorerTx(b.txHash)} target="_blank" rel="noopener noreferrer" className="whale-tx" aria-label={`Transaction ${shortAddr(b.txHash)} on the Elysium explorer`}>
            tx <IconExternal size={12} />
          </a>
        </div>
      </div>
    </li>
  );
}

/** Every recent buy of at least minBuyHype, newest first. */
export function BuyList({ data, showToken, limit }: { data: WhalesResponse; showToken: boolean; limit?: number }): React.ReactElement {
  const buys = limit ? data.buys.slice(0, limit) : data.buys;
  if (!buys.length) {
    return (
      <div className="empty whale-empty">
        <p>
          <strong>No buys of {data.minBuyHype ?? 5} HYPE or more yet.</strong>
        </p>
        <p>{data.source === "indexer" ? "They appear here as they land. It refreshes every 15 seconds." : "Buys are listed once the indexer is running."}</p>
      </div>
    );
  }
  return (
    <ul className="whale-list">
      {buys.map((b) => (
        <BuyRow key={`${b.txHash}:${b.token}`} b={b} showToken={showToken} hypeUsd={data.hypeUsd} />
      ))}
    </ul>
  );
}

export function useWhales(token: string | undefined, type: WhaleSignalType | null) {
  const [data, setData] = useState<WhalesResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s === "ready" ? s : "loading"));
    api
      .whales({ token, type }, ctrl.signal)
      .then((r) => {
        setData(r);
        setState("ready");
        setError(null);
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return;
        setError(e.message);
        setState("error");
      });
    return () => ctrl.abort();
  }, [token, type, tick]);
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return { data, state, error, reload: () => setTick((n) => n + 1) };
}

export function WhaleList({ data, showToken }: { data: WhalesResponse; showToken: boolean }): React.ReactElement {
  if (!data.signals.length) {
    return (
      <div className="empty whale-empty">
        <p>
          <strong>No signals in this window.</strong>
        </p>
        <p>Nothing crossed the thresholds yet. It refreshes every 15 seconds.</p>
      </div>
    );
  }
  return (
    <ul className="whale-list">
      {data.signals.map((s) => (
        <SignalRow key={`${s.type}:${s.txHash}:${s.id}`} s={s} showToken={showToken} />
      ))}
    </ul>
  );
}

export function SourceNote({ data }: { data: WhalesResponse }): React.ReactElement {
  const ix = data.indexer;
  return (
    <p className="whale-source">
      {ix ? (
        <span className={`whale-live whale-live-${ix.mode}`}>
          {ix.mode === "live" ? "Live" : ix.mode === "backfill" ? "Catching up" : ix.mode === "stalled" ? "Paused" : "Starting"}
          {ix.lagSeconds !== null && ix.mode !== "live" ? ` · ${Math.round(ix.lagSeconds)} s behind` : ""} · reading {ix.node}.{" "}
        </span>
      ) : null}
      {data.sourceNote}
      {data.scanned ? ` ${data.scanned.buys} buys and ${data.scanned.sells} sells classified${data.scanned.truncated ? " (newest transactions only)" : ""}.` : ""}
      {data.unavailable.length ? ` ${data.unavailable.map((t) => SIGNAL_LABEL[t]).join(", ")} needs each wallet's funding history and is not shown yet.` : ""}
    </p>
  );
}

/** Compact strip for a token room: the latest five signals for that token. */
export function RoomWhales({ token, symbol }: { token: string; symbol: string }): React.ReactElement {
  const { data, state, error, reload } = useWhales(token, null);
  return (
    <section className="room-whales" aria-label={`Whale watch for ${symbol}`}>
      <header className="panel-head">
        <h2>Whale watch</h2>
        <Link to="/app/whales" className="chip chip-button">
          All signals
        </Link>
      </header>
      {state === "loading" && !data ? <Loom compact label={`Reading recent ${symbol} buys`} /> : null}
      {state === "error" && !data ? (
        <div className="notice notice-error">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <WhaleList data={{ ...data, signals: data.signals.slice(0, 5) }} showToken={false} />
          {data.source === "indexer" ? (
            <>
              <h3 className="whale-subhead">Recent buys of {data.minBuyHype ?? 5} HYPE or more</h3>
              <BuyList data={data} showToken={false} limit={5} />
            </>
          ) : null}
          <SourceNote data={data} />
        </>
      ) : null}
    </section>
  );
}
