// The in-site swap: pick two assets, see a live quote with price impact and the slippage floor, approve when a sell
// needs it, and sign the swap in your own wallet. Routing and calldata live in src/lib/swap.ts.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { CHAIN, explorerTx } from "../config/chain";
import { RpcRevert } from "../lib/rpc";
import {
  buyWithFee,
  buyWithFeeSimulation,
  findVenues,
  leftNothingBehind,
  NATIVE,
  permit2Approve,
  permit2Covers,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_RECIPIENT,
  quoteSwap,
  revertReason,
  type LegQuote,
  type Reader,
  type SwapQuote,
  type TxStep,
  type Venue,
} from "../lib/swap";
import {
  allowance,
  amountInput,
  approveData,
  balanceOf,
  connectedAccount,
  ensureElysium,
  formatAmount,
  parseAmount,
  requestAccount,
  sendTransaction,
  swapRead,
  tokenInfo,
  waitForReceipt,
  walletError,
  walletProvider,
  type TokenInfo,
} from "../lib/wallet";
import { useApp } from "../state";
import { TokenMark } from "./Avatar";
import { IconCheck, IconChevron, IconExternal, IconSettings, IconSwap } from "./icons";
import { Sheet } from "./Sheet";

/* ───────── chain access for the router module ───────── */

// Every swap read goes through swapRead (lib/wallet.ts): the visitor's wallet when it is on Elysium, then the Worker's
// keyed Alchemy endpoint, then the launchpads' nodes. Public community RPCs are never used for swaps.

// Pool discovery fires dozens of reads at once (one per candidate pool and fee tier). Reads made in the same tick are
// folded into one Multicall3 aggregate3 call with per-call failure allowed, so a quote costs a few requests, not fifty.
const MC3 = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
type Pending = { to: string; data: Hex; resolve: (v: Hex | null) => void };
let queue: Pending[] = [];
let flushTimer: number | null = null;
function flush() {
  flushTimer = null;
  const jobs = queue;
  queue = [];
  for (let i = 0; i < jobs.length; i += 60) {
    const chunk = jobs.slice(i, i + 60);
    if (chunk.length === 1) {
      const [j] = chunk;
      swapRead<Hex>("eth_call", [{ to: j.to, data: j.data }, "latest"]).then(j.resolve, () => j.resolve(null));
      continue;
    }
    const data = encodeFunctionData({
      abi: MC3,
      functionName: "aggregate3",
      args: [chunk.map((j) => ({ target: j.to as Hex, allowFailure: true, callData: j.data }))],
    });
    swapRead<Hex>("eth_call", [{ to: CHAIN.multicall3, data }, "latest"])
      .then((raw) => {
        const res = decodeFunctionResult({ abi: MC3, functionName: "aggregate3", data: raw }) as readonly { success: boolean; returnData: Hex }[];
        chunk.forEach((j, k) => j.resolve(res[k]?.success && res[k].returnData !== "0x" ? res[k].returnData : null));
      })
      .catch(() => chunk.forEach((j) => j.resolve(null)));
  }
}

const reader: Reader = {
  call: async (to, data, opts) => {
    if (opts?.from || opts?.value) {
      const tx: Record<string, string> = { to, data };
      if (opts.from) tx.from = opts.from;
      if (opts.value) tx.value = `0x${opts.value.toString(16)}`;
      return swapRead<Hex>("eth_call", [tx, "latest"]).catch(() => null);
    }
    return new Promise<Hex | null>((resolve) => {
      queue.push({ to, data, resolve });
      flushTimer ??= window.setTimeout(flush, 8);
    });
  },
  logs: (f) => swapRead<{ data: `0x${string}`; topics: `0x${string}`[] }[]>("eth_getLogs", [f]).catch(() => null),
};

const venueCache = new Map<string, { at: number; venues: Promise<Venue[]> }>();
function venuesFor(token: string): Promise<Venue[]> {
  const k = token.toLowerCase();
  const hit = venueCache.get(k);
  if (hit && Date.now() - hit.at < 120_000) return hit.venues;
  const venues = findVenues(k, reader).catch(() => [] as Venue[]);
  venueCache.set(k, { at: Date.now(), venues });
  venues.then((v) => {
    if (!v.length) venueCache.delete(k);
  });
  return venues;
}

const SLIPPAGE_PRESETS = [50, 100, 300, 500];
const SLIPPAGE_KEY = "threadsium-slippage-bps";
function savedSlippage(): number {
  try {
    const v = Number(localStorage.getItem(SLIPPAGE_KEY));
    return v >= 5 && v <= 5000 ? v : 100;
  } catch {
    return 100;
  }
}

type StepState = "pending" | "active" | "done" | "error";
interface Step {
  label: string;
  state: StepState;
  hash?: string;
}

const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

/* ───────── asset picker ───────── */

function AssetPicker({ value, onPick, onClose }: { value: string; onPick: (address: string) => void; onClose: () => void }) {
  const { tokens } = useApp();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = useMemo(() => {
    const all = [{ address: NATIVE, symbol: "HYPE", name: "Native HYPE", imageUrl: null as string | null | undefined, featured: true, hypeDepth: Infinity }, ...tokens];
    return all
      .filter((t) => !query || t.symbol.toLowerCase().includes(query.replace(/^\$/, "")) || t.name.toLowerCase().includes(query) || t.address === query)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth)
      .slice(0, 60);
  }, [tokens, query]);
  const pasted = /^0x[0-9a-f]{40}$/.test(query) && !list.some((t) => t.address === query) ? query : null;
  return (
    <Sheet title="Choose an asset" onClose={onClose}>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a ticker or paste a 0x address" aria-label="Search assets" spellCheck={false} autoFocus />
      <ul className="asset-list" role="listbox" aria-label="Assets">
        {pasted ? (
          <li>
            <button type="button" className="asset-row" onClick={() => onPick(pasted)}>
              <TokenMark address={pasted} symbol="?" size={30} />
              <span className="asset-main">
                <strong>Use this contract</strong>
                <span className="mono">{pasted}</span>
              </span>
            </button>
          </li>
        ) : null}
        {list.map((t) => (
          <li key={t.address}>
            <button type="button" className={`asset-row${t.address === value ? " is-on" : ""}`} role="option" aria-selected={t.address === value} onClick={() => onPick(t.address)}>
              {t.address === NATIVE ? <span className="asset-native" aria-hidden="true">H</span> : <TokenMark address={t.address} symbol={t.symbol} imageUrl={t.imageUrl ?? null} size={30} />}
              <span className="asset-main">
                <strong>{t.address === NATIVE ? "HYPE" : `$${t.symbol}`}</strong>
                <span>{t.name || t.address}</span>
              </span>
              {t.address === value ? <IconCheck size={18} /> : null}
            </button>
          </li>
        ))}
        {!list.length && !pasted ? <li className="hint asset-empty">No match. Paste the token's 0x contract address.</li> : null}
      </ul>
    </Sheet>
  );
}

function AssetButton({ address, info, onClick, label }: { address: string; info: TokenInfo | null; onClick: () => void; label: string }) {
  const { tokenByAddress } = useApp();
  const known = tokenByAddress(address);
  const symbol = address === NATIVE ? "HYPE" : info?.symbol ?? known?.symbol ?? "…";
  return (
    <button type="button" className="asset-btn" onClick={onClick} aria-label={`${label}: ${symbol}. Change`}>
      {address === NATIVE ? <span className="asset-native" aria-hidden="true">H</span> : <TokenMark address={address} symbol={symbol} imageUrl={known?.imageUrl ?? null} size={24} />}
      <span>{symbol}</span>
      <IconChevron size={16} />
    </button>
  );
}

/* ───────── panel ───────── */

export function SwapPanel({ defaultOut, compact = false }: { defaultOut?: string; compact?: boolean }): React.ReactElement {
  const { hypeUsd, toast } = useApp();
  const [tokenIn, setTokenIn] = useState<string>(NATIVE);
  const [tokenOut, setTokenOut] = useState<string>(defaultOut?.toLowerCase() ?? "");
  const [infoIn, setInfoIn] = useState<TokenInfo | null>(null);
  const [infoOut, setInfoOut] = useState<TokenInfo | null>(null);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(savedSlippage);
  const [customSlip, setCustomSlip] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [picking, setPicking] = useState<null | "in" | "out">(null);
  const [account, setAccount] = useState<string | null>(null);
  const [balIn, setBalIn] = useState<bigint | null>(null);
  const [balOut, setBalOut] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [acceptImpact, setAcceptImpact] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const quoteSeq = useRef(0);
  const hasWallet = !!walletProvider();

  useEffect(() => {
    if (defaultOut) setTokenOut(defaultOut.toLowerCase());
  }, [defaultOut]);

  useEffect(() => {
    connectedAccount().then(setAccount);
    const eth = walletProvider();
    const onAccounts = (a: unknown) => setAccount(Array.isArray(a) && typeof a[0] === "string" ? a[0].toLowerCase() : null);
    const onChain = () => {
      venueCache.clear();
      setRefresh((n) => n + 1);
    };
    eth?.on?.("accountsChanged", onAccounts);
    eth?.on?.("chainChanged", onChain);
    return () => {
      eth?.removeListener?.("accountsChanged", onAccounts);
      eth?.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    let live = true;
    setInfoIn(null);
    if (tokenIn) tokenInfo(tokenIn, "swap").then((i) => live && setInfoIn(i));
    return () => {
      live = false;
    };
  }, [tokenIn]);
  useEffect(() => {
    let live = true;
    setInfoOut(null);
    if (tokenOut) tokenInfo(tokenOut, "swap").then((i) => live && setInfoOut(i));
    return () => {
      live = false;
    };
  }, [tokenOut]);

  // Balances follow the account, the pair and every finished swap.
  useEffect(() => {
    if (!account) {
      setBalIn(null);
      setBalOut(null);
      return;
    }
    let live = true;
    if (tokenIn) balanceOf(tokenIn, account, "swap").then((b) => live && setBalIn(b));
    if (tokenOut) balanceOf(tokenOut, account, "swap").then((b) => live && setBalOut(b));
    return () => {
      live = false;
    };
  }, [account, tokenIn, tokenOut, refresh]);

  const amountIn = infoIn ? parseAmount(amount, infoIn.decimals) : null;

  // A new pair or amount starts a new trade: the last run's progress and error no longer apply.
  useEffect(() => {
    if (running) return;
    setSteps(null);
    setRunError(null);
  }, [tokenIn, tokenOut, amount]);

  // Debounced quote; refreshed every 20 s while the panel is idle and visible.
  useEffect(() => {
    setAcceptImpact(false);
    if (!tokenIn || !tokenOut || amountIn === null) {
      setQuote(null);
      setQuoteState("idle");
      setQuoteError(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoteState((s) => (s === "ready" ? "ready" : "loading"));
    const run = async () => {
      const r = await quoteSwap(tokenIn, tokenOut, amountIn, slippage, venuesFor).catch((e: Error) => ({ error: e.message || "The quote failed." }));
      if (seq !== quoteSeq.current) return;
      if ("error" in r) {
        setQuote(null);
        setQuoteError(r.error);
        setQuoteState("error");
      } else {
        setQuote(r);
        setQuoteError(null);
        setQuoteState("ready");
      }
    };
    const t = window.setTimeout(run, 450);
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible" && !running) run();
    }, 20_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(every);
    };
  }, [tokenIn, tokenOut, amount, infoIn?.decimals, slippage, refresh]);

  // Whether the first leg is a sell that still needs an allowance.
  useEffect(() => {
    setNeedsApproval(false);
    const leg = quote?.legs[0];
    if (!leg || leg.side !== "sell" || !account) return;
    let live = true;
    (async () => {
      const a = await allowance(leg.token, account, leg.venue.spender, "swap");
      let need = a === null || a < leg.amountIn;
      if (!need && leg.venue.permit2) {
        const until = BigInt(Math.floor(Date.now() / 1000) + 600);
        need = !(await permit2Covers(reader, account, leg.token, leg.venue.router, leg.amountIn, until));
      }
      if (live) setNeedsApproval(need);
    })();
    return () => {
      live = false;
    };
  }, [quote, account]);

  const symIn = tokenIn === NATIVE ? "HYPE" : infoIn?.symbol ?? "…";
  const symOut = tokenOut === NATIVE ? "HYPE" : infoOut?.symbol ?? "…";
  const outDecimals = infoOut?.decimals ?? 18;
  const insufficient = amountIn !== null && balIn !== null && amountIn > balIn;
  const impact = quote?.impactBps ?? null;
  const highImpact = impact !== null && impact >= 1000;
  const usdIn = tokenIn === NATIVE && amountIn !== null && hypeUsd ? (Number(amountIn) / 1e18) * hypeUsd : null;
  const usdOut = tokenOut === NATIVE && quote && hypeUsd ? (Number(quote.out) / 1e18) * hypeUsd : null;

  const flip = () => {
    if (running) return;
    setTokenIn(tokenOut || NATIVE);
    setTokenOut(tokenIn);
    setAmount("");
  };

  const pick = (address: string) => {
    const a = address.toLowerCase();
    if (picking === "in") {
      if (a === tokenOut) setTokenOut(tokenIn);
      setTokenIn(a);
    } else {
      if (a === tokenIn) setTokenIn(tokenOut || NATIVE);
      setTokenOut(a);
    }
    setPicking(null);
  };

  const setSlip = (bps: number) => {
    setSlippage(bps);
    try {
      localStorage.setItem(SLIPPAGE_KEY, String(bps));
    } catch {
      /* private window */
    }
  };

  const mark = (i: number, state: StepState, hash?: string) =>
    setSteps((cur) => (cur ? cur.map((s, k) => (k === i ? { ...s, state, ...(hash ? { hash } : {}) } : s)) : cur));

  const execute = async () => {
    if (!quote || running) return;
    setRunError(null);
    setRunning(true);
    let from = account;
    try {
      from ??= await requestAccount();
      setAccount(from);
      await ensureElysium();

      // Plan every step up front so the visitor sees the whole path.
      const plan: { label: string; run: () => Promise<string> }[] = [];
      const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200);
      for (const leg of quote.legs) {
        const legSym = leg.side === "sell" ? (leg.token === tokenIn ? symIn : "token") : "HYPE";
        if (leg.side === "sell") {
          const a = await allowance(leg.token, from, leg.venue.spender, "swap");
          if (a === null || a < leg.amountIn) {
            plan.push({
              label: `Allow ${leg.venue.permit2 ? "Permit2" : leg.venue.name} to spend ${legSym}`,
              run: () => sendTransaction(from!, { to: leg.token, data: approveData(leg.venue.spender, leg.amountIn) }),
            });
          }
          if (leg.venue.permit2) {
            const until = BigInt(Math.floor(Date.now() / 1000) + 1800);
            if (!(await permit2Covers(reader, from, leg.token, leg.venue.router, leg.amountIn, until - 900n))) {
              const p2 = permit2Approve(leg.token, leg.venue.router, leg.amountIn, until);
              plan.push({ label: `Let ${leg.venue.name} use the Permit2 allowance`, run: () => sendTransaction(from!, p2) });
            }
          }
        }
        const legIndex = quote.legs.indexOf(leg);
        if (legIndex !== quote.fee.leg) {
          plan.push({ label: swapLabel(leg, symIn, symOut, infoIn), run: () => runTx(from!, leg.venue.tx(leg.side, leg.amountIn, leg.minOut, from!, deadline())) });
          continue;
        }
        const feeText = `${formatAmount(quote.fee.wei, 18)} HYPE`;
        const feeStep = { label: `Platform fee: ${feeText} (${pct(PLATFORM_FEE_BPS)})`, run: () => sendTransaction(from!, { to: PLATFORM_FEE_RECIPIENT, value: quote.fee.wei }) };
        if (leg.side === "buy") {
          // One transaction through Multicall3 (swap and fee succeed or fail together), when the simulation shows the
          // router leaves no HYPE behind in Multicall3; otherwise the swap and the fee as two transactions.
          const swap = leg.venue.tx("buy", leg.amountIn, leg.minOut, from, deadline());
          const sim = buyWithFeeSimulation(swap, quote.fee.wei);
          const answer = await swapRead<Hex>("eth_call", [{ from, to: sim.to, data: sim.data, value: `0x${sim.value.toString(16)}` }, "latest"]).catch(() => null);
          if (leftNothingBehind(answer, sim.value)) {
            plan.push({ label: `${swapLabel(leg, symIn, symOut, infoIn)}, ${pct(PLATFORM_FEE_BPS)} fee included`, run: () => runTx(from!, buyWithFee(leg.venue.tx("buy", leg.amountIn, leg.minOut, from!, deadline()), quote.fee.wei)) });
          } else {
            plan.push({ label: swapLabel(leg, symIn, symOut, infoIn), run: () => runTx(from!, leg.venue.tx("buy", leg.amountIn, leg.minOut, from!, deadline())) });
            plan.push(feeStep);
          }
        } else if (leg.venue.sellWithFee) {
          // The router pays the fee out of the sale's own HYPE, in the same transaction.
          plan.push({
            label: `${swapLabel(leg, symIn, symOut, infoIn)}, ${pct(PLATFORM_FEE_BPS)} fee included`,
            run: () => runTx(from!, leg.venue.sellWithFee!(leg.amountIn, leg.minOut, from!, deadline(), PLATFORM_FEE_RECIPIENT, PLATFORM_FEE_BPS)),
          });
        } else {
          plan.push({ label: swapLabel(leg, symIn, symOut, infoIn), run: () => runTx(from!, leg.venue.tx("sell", leg.amountIn, leg.minOut, from!, deadline())) });
          plan.push(feeStep);
        }
      }
      setSteps(plan.map((p) => ({ label: p.label, state: "pending" })));

      for (let i = 0; i < plan.length; i++) {
        mark(i, "active");
        try {
          const hash = await plan[i].run();
          mark(i, "active", hash);
          const r = await waitForReceipt(hash, 90_000, "swap");
          if (r.status !== "success") throw new Error("The transaction reverted on chain.");
          mark(i, "done", hash);
        } catch (e) {
          mark(i, "error");
          throw e;
        }
      }
      toast(`Swapped ${symIn} for ${symOut}`);
      setAmount("");
    } catch (e) {
      setRunError(e instanceof RpcRevert ? revertReason(e.data, e.message) : walletError(e));
    } finally {
      setRunning(false);
      setRefresh((n) => n + 1);
    }
  };

  let action: { label: string; disabled: boolean; onClick?: () => void };
  if (!tokenOut) action = { label: "Choose a token to receive", disabled: true };
  else if (amountIn === null) action = { label: "Enter an amount", disabled: true };
  else if (insufficient) action = { label: `Not enough ${symIn}`, disabled: true };
  else if (quoteState === "loading" && !quote) action = { label: "Finding the best pool…", disabled: true };
  else if (!quote) action = { label: "No route", disabled: true };
  else if (highImpact && !acceptImpact) action = { label: "Accept the price impact first", disabled: true };
  else if (!hasWallet) action = { label: "Install a browser wallet to swap", disabled: true };
  else if (running) action = { label: "Working in your wallet…", disabled: true };
  else if (!account) action = { label: "Connect wallet and swap", disabled: false, onClick: execute };
  else action = { label: needsApproval ? `Approve ${symIn} and swap` : quote.legs.length > 1 ? "Swap (2 transactions)" : "Swap", disabled: false, onClick: execute };

  return (
    <section className={`swap-panel${compact ? " swap-compact" : ""}`} aria-label="Swap">
      <header className="swap-head">
        <h2>
          <IconSwap size={18} /> Swap
        </h2>
        <button type="button" className="chip chip-button" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)} aria-label={`Slippage ${pct(slippage)}. Change`}>
          <IconSettings size={15} /> {pct(slippage)} slippage
        </button>
      </header>

      {showSettings ? (
        <div className="swap-settings">
          <span className="label-soft">Max slippage</span>
          <div className="segmented" role="group" aria-label="Slippage tolerance">
            {SLIPPAGE_PRESETS.map((b) => (
              <button key={b} type="button" className={slippage === b ? "is-on" : ""} aria-pressed={slippage === b} onClick={() => setSlip(b)}>
                {pct(b)}
              </button>
            ))}
          </div>
          <input
            className="field swap-slip-input"
            inputMode="decimal"
            placeholder="Custom %"
            aria-label="Custom slippage in percent"
            value={customSlip}
            onChange={(e) => {
              setCustomSlip(e.target.value);
              const v = Number(e.target.value);
              if (v > 0 && v <= 50) setSlip(Math.round(v * 100));
            }}
          />
          {slippage > 500 ? <p className="hint swap-warn">High slippage: the swap may fill well below the quote.</p> : null}
        </div>
      ) : null}

      <div className="swap-box">
        <div className="swap-box-top">
          <label htmlFor={`swap-in-${compact ? "c" : "p"}`}>You pay</label>
          {balIn !== null && infoIn ? (
            <button type="button" className="link-btn swap-bal" onClick={() => setAmount(amountInput(tokenIn === NATIVE && balIn > 10n ** 16n ? balIn - 10n ** 16n : balIn, infoIn.decimals))}>
              Balance {formatAmount(balIn, infoIn.decimals)} · Max
            </button>
          ) : null}
        </div>
        <div className="swap-box-row">
          <input
            id={`swap-in-${compact ? "c" : "p"}`}
            className="swap-amount mono"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={running}
          />
          <AssetButton address={tokenIn} info={infoIn} label="Pay with" onClick={() => !running && setPicking("in")} />
        </div>
        {usdIn !== null ? <span className="swap-usd">≈ ${usdIn.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : null}
      </div>

      <div className="swap-flip-row">
        <button type="button" className="swap-flip" onClick={flip} aria-label="Swap the two assets" disabled={running || !tokenOut}>
          <IconSwap size={18} />
        </button>
      </div>

      <div className="swap-box">
        <div className="swap-box-top">
          <span>You receive</span>
          {balOut !== null && infoOut ? <span className="swap-bal">Balance {formatAmount(balOut, infoOut.decimals)}</span> : null}
        </div>
        <div className="swap-box-row">
          <output className={`swap-amount mono${quoteState === "loading" ? " is-stale" : ""}`} aria-live="polite">
            {quote ? formatAmount(quote.out, outDecimals) : "0.0"}
          </output>
          {tokenOut ? (
            <AssetButton address={tokenOut} info={infoOut} label="Receive" onClick={() => !running && setPicking("out")} />
          ) : (
            <button type="button" className="asset-btn asset-btn-empty" onClick={() => setPicking("out")}>
              Choose <IconChevron size={16} />
            </button>
          )}
        </div>
        {usdOut !== null ? <span className="swap-usd">≈ ${usdOut.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : null}
      </div>

      {quoteError ? (
        <p className="form-error" role="alert">
          {quoteError}{" "}
          {tokenOut && tokenOut !== NATIVE ? <Link to={`/app/token/${tokenOut}`}>Open the token room for its launchpad links.</Link> : null}
        </p>
      ) : null}

      {quote ? (
        <dl className="swap-details">
          <div>
            <dt>Rate</dt>
            <dd className="mono">
              1 {symIn} ≈ {infoIn ? rate(quote.amountIn, infoIn.decimals, quote.out, outDecimals) : "…"} {symOut}
            </dd>
          </div>
          <div>
            <dt>Price impact</dt>
            <dd className={impact !== null && impact >= 500 ? "is-down" : ""}>{impact === null ? "not measurable" : impact < 1 ? "< 0.01%" : pct(impact)}</dd>
          </div>
          <div>
            <dt>Minimum received</dt>
            <dd className="mono">
              {formatAmount(quote.minOut, outDecimals)} {symOut}
            </dd>
          </div>
          <div>
            <dt>Platform fee</dt>
            <dd className="mono">
              {formatAmount(quote.fee.wei, 18)} HYPE ({pct(PLATFORM_FEE_BPS)})
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{quote.legs.map((l) => l.venue.name).join(" → ")}</dd>
          </div>
        </dl>
      ) : null}

      {quote && quote.legs.length > 1 ? (
        <p className="hint">This pair routes through HYPE in two transactions. The second spends only the first one's guaranteed minimum, so a little HYPE may stay in your wallet.</p>
      ) : null}
      {highImpact ? (
        <label className="swap-accept">
          <input type="checkbox" checked={acceptImpact} onChange={(e) => setAcceptImpact(e.target.checked)} />
          <span>
            This trade moves the price by <strong className="is-down">{pct(impact!)}</strong>. I understand I will receive far less than the current price suggests.
          </span>
        </label>
      ) : null}

      <button type="button" className="btn btn-primary btn-block btn-large" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </button>

      {steps ? (
        <ol className="swap-steps" aria-label="Swap progress">
          {steps.map((s, i) => (
            <li key={i} className={`swap-step is-${s.state}`}>
              <span className="swap-step-dot" aria-hidden="true">
                {s.state === "done" ? <IconCheck size={14} /> : i + 1}
              </span>
              <span className="swap-step-label">
                {s.label}
                <span className="sr-only">: {s.state}</span>
              </span>
              {s.hash ? (
                <a href={explorerTx(s.hash)} target="_blank" rel="noopener noreferrer" className="swap-step-link" aria-label="View transaction on the Elysium explorer">
                  tx <IconExternal size={12} />
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {runError ? (
        <p className="form-error" role="alert">
          {runError}
        </p>
      ) : null}

      <p className="hint swap-fine">
        Quotes come straight from the pools' own quoters on Elysium 99901, read through your wallet's own connection when it has one. Threadsium takes a {pct(PLATFORM_FEE_BPS)} platform fee in HYPE (shown above, included in the amounts) and never holds funds; your wallet signs every step.
      </p>

      {picking ? <AssetPicker value={picking === "in" ? tokenIn : tokenOut} onPick={pick} onClose={() => setPicking(null)} /> : null}
    </section>
  );
}

function swapLabel(leg: LegQuote, symIn: string, symOut: string, infoIn: TokenInfo | null): string {
  if (leg.side === "buy") return `Buy ${symOut} with ${formatAmount(leg.amountIn, 18)} HYPE on ${leg.venue.name}`;
  return `Sell ${infoIn ? formatAmount(leg.amountIn, infoIn.decimals) : ""} ${symIn} for HYPE on ${leg.venue.name}`.replace(/\s+/g, " ");
}

/** Simulates the transaction from the visitor's wallet first, so a revert shows its reason instead of a failed transaction. */
async function runTx(from: string, tx: TxStep): Promise<string> {
  await swapRead("eth_call", [{ from, to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}` }, "latest"]);
  return sendTransaction(from, tx);
}

function rate(amountIn: bigint, decIn: number, out: bigint, decOut: number): string {
  if (amountIn === 0n) return "0";
  const r = (Number(out) / 10 ** decOut) / (Number(amountIn) / 10 ** decIn);
  if (!Number.isFinite(r)) return "…";
  return r >= 1000 ? r.toLocaleString(undefined, { maximumFractionDigits: 0 }) : r >= 1 ? r.toFixed(4) : r.toPrecision(4);
}
