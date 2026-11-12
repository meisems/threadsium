// /app/whales: Whale watch for all of Elysium 99901: every buy of 5 HYPE and up, and the four signals.
import React, { useState } from "react";
import { Loom } from "../components/brand";
import { BuyList, SIGNAL_LABEL, SIGNAL_RULE, SourceNote, useWhales, WhaleList } from "../components/WhaleSignals";
import type { WhaleSignalType } from "../lib/api";

type View = "BUYS" | "ALL" | WhaleSignalType;
const VIEWS: View[] = ["BUYS", "ALL", "WHALE_BUY", "FRESH_BUY", "ACCUMULATION", "CLUSTER"];

export function Whales(): React.ReactElement {
  const [view, setView] = useState<View>("BUYS");
  const type = view === "BUYS" || view === "ALL" ? null : view;
  const { data, state, error, reload } = useWhales(undefined, type);
  const min = data?.minBuyHype ?? 5;
  const label = (v: View) => (v === "BUYS" ? `Buys ${min}+ HYPE` : v === "ALL" ? "All signals" : SIGNAL_LABEL[v]);
  const count = (v: View) => (data?.counts && v !== "BUYS" && v !== "ALL" ? data.counts[v] : null);
  return (
    <>
      <header className="page-head">
        <h1>Whale watch</h1>
        <p>
          Every buy of {min} HYPE or more on Elysium as it lands, and the signals in them: whale buys, fresh wallets, accumulation and funded clusters. Signals
          describe on-chain activity; they are not advice.
        </p>
      </header>
      <div className="whale-filters" role="tablist" aria-label="What to show">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`chip chip-button${view === v ? " is-on" : ""}`}
            disabled={v !== "BUYS" && v !== "ALL" && !!data?.unavailable.includes(v)}
            onClick={() => setView(v)}
          >
            {label(v)}
            {count(v) ? (
              <span className="whale-count" title="In the last 24 hours">
                {count(v)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {type && data ? <p className="whale-rule">{SIGNAL_RULE[type](data.thresholds)}</p> : null}
      {view === "BUYS" && data ? <p className="whale-rule">Every buy of at least {min} HYPE, newest first. Buys from fresh wallets are marked.</p> : null}
      {state === "loading" && !data ? <Loom label="Reading the latest Elysium blocks" /> : null}
      {state === "error" && !data ? (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          {view === "BUYS" ? <BuyList data={data} showToken /> : <WhaleList data={data} showToken />}
          <SourceNote data={data} />
        </>
      ) : null}
    </>
  );
}
