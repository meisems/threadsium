// /app/whales: Whale watch, whale and fresh-wallet signals for all of Elysium 99901.
import React, { useState } from "react";
import { Loom } from "../components/brand";
import { SIGNAL_LABEL, SIGNAL_RULE, SourceNote, useWhales, WhaleList } from "../components/WhaleSignals";
import type { WhaleSignalType } from "../lib/api";

const TYPES: (WhaleSignalType | null)[] = [null, "WHALE_BUY", "FRESH_BUY", "ACCUMULATION", "CLUSTER"];

export function Whales(): React.ReactElement {
  const [type, setType] = useState<WhaleSignalType | null>(null);
  const { data, state, error, reload } = useWhales(undefined, type);
  return (
    <>
      <header className="page-head">
        <h1>Whale watch</h1>
        <p>Big buys and fresh-wallet buys on Elysium tokens as they land on chain, read straight from the chain. Signals describe on-chain activity; they are not advice.</p>
      </header>
      <div className="whale-filters" role="tablist" aria-label="Signal type">
        {TYPES.map((t) => (
          <button
            key={t ?? "all"}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={`chip chip-button${type === t ? " is-on" : ""}`}
            disabled={!!t && !!data?.unavailable.includes(t)}
            onClick={() => setType(t)}
          >
            {t ? SIGNAL_LABEL[t] : "All"}
          </button>
        ))}
      </div>
      {type && data ? <p className="whale-rule">{SIGNAL_RULE[type](data.thresholds)}</p> : null}
      {state === "loading" && !data ? <Loom label="Scanning the latest Elysium blocks" /> : null}
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
          <WhaleList data={data} showToken />
          <SourceNote data={data} />
        </>
      ) : null}
    </>
  );
}
