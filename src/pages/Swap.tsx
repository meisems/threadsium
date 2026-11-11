// /app/swap: the standalone swap page. ?out=0x… (or ?in=) preselects a token.
import React from "react";
import { useSearchParams } from "react-router";
import { SwapPanel } from "../components/SwapPanel";

export function Swap(): React.ReactElement {
  const [params] = useSearchParams();
  const out = params.get("out");
  const preset = out && /^0x[0-9a-fA-F]{40}$/.test(out) ? out.toLowerCase() : undefined;
  return (
    <>
      <header className="page-head">
        <h1>Swap</h1>
        <p>Trade HYPE and Elysium tokens without leaving Threadsium. Each quote compares every live pool for the token and routes through the one that pays the most.</p>
      </header>
      <div className="swap-page">
        <SwapPanel defaultOut={preset} />
      </div>
    </>
  );
}
