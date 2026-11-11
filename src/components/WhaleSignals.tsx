// Whale and fresh-wallet signals (ported from Elywake): a list for /app/whales and a compact strip for token rooms.
import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { explorerAddress, explorerTx } from "../config/chain";
import { api, type WhaleSignal, type WhaleSignalType, type WhalesResponse } from "../lib/api";
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
  CLUSTER: () => "Three or more fresh wallets funded by the same address buying one token within minutes.",
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
            <span>{s.clusterWallets.length} wallets</span>
          ) : null}
          {s.walletNonce !== null ? <span title="Transactions the wallet had sent by this buy">nonce {s.walletNonce}</span> : null}
          {s.launchpad && s.launchpad !== "unknown" ? <span>{s.launchpad}</span> : null}
          <time dateTime={new Date(s.time).toISOString()} title={fullTime(s.time)}>
            {ago(s.time)}
          </time>
          <a href={explorerTx(s.txHash)} target="_blank" rel="noopener noreferrer" className="whale-tx" aria-label={`Transaction ${shortAddr(s.txHash)} on elyscan`}>
            tx <IconExternal size={12} />
          </a>
        </div>
      </div>
    </li>
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
    const id = window.setInterval(() => document.visibilityState === "visible" && setTick((n) => n + 1), 30_000);
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
        <p>{data.source === "scan" ? "Nothing crossed the thresholds in the blocks scanned. It refreshes every 30 seconds." : "Elywake has not flagged anything here yet."}</p>
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
  return (
    <p className="whale-source">
      {data.sourceNote}
      {data.scanned ? ` ${data.scanned.buys} buys and ${data.scanned.sells} sells classified${data.scanned.truncated ? " (newest transactions only)" : ""}.` : ""}
      {data.unavailable.length ? ` ${data.unavailable.map((t) => SIGNAL_LABEL[t]).join(", ")} needs the full Elywake indexer and is not shown here.` : ""}
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
      {state === "loading" && !data ? <Loom compact label={`Scanning recent ${symbol} buys`} /> : null}
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
          <SourceNote data={data} />
        </>
      ) : null}
    </section>
  );
}
