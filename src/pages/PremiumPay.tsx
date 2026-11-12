// Pay in HYPE instead of holding: one payment of a tier's THREADSIUM amount, valued in HYPE at a locked quote,
// buys PREMIUM.paidDays. HYPE goes to the platform fee wallet; the server checks the transaction on chain.
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PremiumMark } from "../components/Badge";
import { IconExternal } from "../components/icons";
import { explorerAddress, explorerTx } from "../config/chain";
import { DEFAULT_BADGE, PREMIUM, TIER_LABEL, type Badge, type PaidTier } from "../config/premium";
import { ApiError, api, type Me, type PremiumQuote, type PremiumStatus } from "../lib/api";
import { shortAddr } from "../lib/format";
import { requestAccount, sendTransaction, walletError, walletProvider } from "../lib/wallet";
import { useApp } from "../state";

const fmt = (n: number) => n.toLocaleString("en-US");
const MAX_MARK: Badge = { icon: "crown", color: "gold" };
const PENDING_KEY = "threadsium.premiumPay.pending";

type Pending = { txHash: string; quoteId: string | null; tier: PaidTier };

function readPending(): Pending | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
    return v && typeof v.txHash === "string" ? (v as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(p: Pending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode: resuming after a reload will need the hash pasted */
  }
}

const when = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const priceText = (p: number) => (p >= 0.01 ? p.toFixed(4) : p.toPrecision(3));

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

export function PayCard({ user, status, onStatus }: { user: Me; status: PremiumStatus | null; onStatus: (s: PremiumStatus) => void }): React.ReactElement {
  const { setUser, toast } = useApp();
  const [quote, setQuote] = useState<PremiumQuote | null>(null);
  const [busy, setBusy] = useState<null | PaidTier | "send" | "check">(null);
  const [pending, setPending] = useState<Pending | null>(() => readPending());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const [hypeUsd, setHypeUsd] = useState<number | null>(null);
  const polling = useRef(false);
  const left = useCountdown(quote?.expiresAt ?? null);
  const eth = walletProvider();
  const pay = status?.pay;
  const available = !!pay?.available;
  const verified = !!user.walletAddress && user.walletVerified;

  useEffect(() => {
    api
      .price()
      .then((r) => setHypeUsd(r.hypeUsd))
      .catch(() => undefined);
  }, []);

  const confirm = async (txHash: string, quoteId: string | null) => {
    if (polling.current) return;
    polling.current = true;
    setBusy("check");
    setError("");
    try {
      // Up to ~3 minutes: Elysium blocks are fast, but RPCs and wallets can lag.
      for (let i = 0; i < 45; i++) {
        const r = await api.premiumPay(txHash, quoteId);
        if (!r.pending) {
          setUser(r.user);
          writePending(null);
          setPending(null);
          setQuote(null);
          setHash("");
          setNote("");
          toast(`${TIER_LABEL[r.payment.tier]} active until ${when(r.payment.until)}`);
          api.premium().then(onStatus).catch(() => undefined);
          return;
        }
        setNote(r.message);
        await new Promise((res) => setTimeout(res, 4000));
      }
      setNote("Still waiting for the transaction. Your payment is safe; check again in a few minutes.");
    } catch (e) {
      setError((e as Error).message);
      // A definite refusal (wrong wallet, no matching quote…) ends the pending state; RPC or network trouble keeps it.
      const code = e instanceof ApiError ? e.status : 0;
      if (code !== 0 && code !== 502 && code !== 429) {
        writePending(null);
        setPending(null);
        setNote("");
      }
    } finally {
      polling.current = false;
      setBusy(null);
    }
  };

  // Resume a payment that was sent before a reload.
  useEffect(() => {
    if (pending && available && verified) void confirm(pending.txHash, pending.quoteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, verified]);

  const getQuote = async (tier: PaidTier) => {
    setBusy(tier);
    setError("");
    setNote("");
    try {
      setQuote((await api.premiumQuote(tier)).quote);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!quote || !eth) return;
    setBusy("send");
    setError("");
    try {
      const from = await requestAccount();
      if (from.toLowerCase() !== quote.wallet.toLowerCase()) {
        throw new Error(`Switch your wallet to ${shortAddr(quote.wallet, 8, 6)}, the address verified on this account.`);
      }
      const txHash = await sendTransaction(from, { to: quote.treasury, value: BigInt(quote.amountWei) });
      const p: Pending = { txHash, quoteId: quote.id, tier: quote.tier };
      writePending(p);
      setPending(p);
      setBusy(null);
      setNote("Payment sent. Waiting for it to confirm…");
      await confirm(txHash, quote.id);
    } catch (e) {
      setError(walletError(e));
      setBusy(null);
    }
  };

  const expired = !!quote && left <= 0;
  const usd = quote && hypeUsd ? Number(quote.amountHype) * hypeUsd : null;

  const option = (tier: PaidTier) => {
    const tokens = tier === "max" ? PREMIUM.maxMinTokens : PREMIUM.minTokens;
    return (
      <div className={`pay-option${tier === "max" ? " is-max" : ""}`}>
        <span className="pay-option-head">
          <PremiumMark badge={tier === "max" ? MAX_MARK : DEFAULT_BADGE} size={20} />
          <strong>{TIER_LABEL[tier]}</strong>
          <span className="tag">{PREMIUM.paidDays} days</span>
        </span>
        <span className="hint">
          The HYPE value of {fmt(tokens)} {PREMIUM.symbol} right now.
        </span>
        <button
          type="button"
          className={`btn btn-small ${tier === "max" ? "btn-ink" : "btn-premium"}`}
          disabled={!available || !verified || !!busy || !!pending}
          onClick={() => void getQuote(tier)}
        >
          {busy === tier ? "Getting the price…" : "See price"}
        </button>
      </div>
    );
  };

  return (
    <section className="premium-card premium-pay" aria-labelledby="premium-pay-h">
      <div className="premium-status-head">
        <h2 id="premium-pay-h">Or pay in HYPE</h2>
        {user.paidUntil && user.paidTier !== "basic" ? (
          <span className={`tag tag-premium${user.paidTier === "max" ? " tag-max" : ""}`}>
            Paid {TIER_LABEL[user.paidTier]} until {when(user.paidUntil)}
          </span>
        ) : null}
      </div>
      <p className="settings-note">
        Not holding? Pay what the tier's {PREMIUM.symbol} is worth in HYPE at today's price, on Elysium, for {PREMIUM.paidDays} days. Paying again
        adds another {PREMIUM.paidDays} days. Upgrading from paid Premium to Max credits your unused Premium time.
      </p>

      {!available && status ? (
        <p className="premium-notice">Paying opens when the {PREMIUM.symbol} token is live and has a price.</p>
      ) : !verified ? (
        <p className="premium-notice">
          Payments must come from your verified wallet. <Link to="/app/settings">Verify it in Settings</Link> first.
        </p>
      ) : null}

      {!quote ? (
        <div className="pay-options">
          {option("premium")}
          {option("max")}
        </div>
      ) : (
        <div className={`pay-quote${expired ? " is-expired" : ""}`} aria-live="polite">
          <div className="pay-quote-amount">
            <PremiumMark badge={quote.tier === "max" ? MAX_MARK : DEFAULT_BADGE} size={22} />
            <span>
              <strong>{quote.amountHype} HYPE</strong>
              {usd ? <span className="hint"> ≈ ${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> : null}
            </span>
          </div>
          <dl className="pay-quote-facts">
            <dt>For</dt>
            <dd>
              {TIER_LABEL[quote.tier]}, {quote.days} days · active until {when(quote.paidUntilAfter)}
            </dd>
            <dt>Price</dt>
            <dd>
              {fmt(quote.tokens)} {PREMIUM.symbol} × {priceText(quote.priceHype)} HYPE ({quote.source})
            </dd>
            <dt>Pays to</dt>
            <dd>
              <a href={explorerAddress(quote.treasury)} target="_blank" rel="noopener noreferrer" className="mono">
                {shortAddr(quote.treasury, 8, 6)} <IconExternal size={12} />
              </a>{" "}
              Threadsium fee wallet
            </dd>
            <dt>From</dt>
            <dd className="mono">{shortAddr(quote.wallet, 8, 6)}</dd>
            <dt>Price held</dt>
            <dd>{expired ? "Expired. Get a new price." : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`}</dd>
          </dl>
          <div className="settings-row">
            {expired ? (
              <button type="button" className="btn btn-premium" disabled={!!busy} onClick={() => void getQuote(quote.tier)}>
                Get a new price
              </button>
            ) : (
              <button type="button" className="btn btn-premium" disabled={!!busy || !!pending || !eth} onClick={() => void send()}>
                {busy === "send" ? "Confirm in your wallet…" : `Pay ${quote.amountHype} HYPE`}
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={busy === "send" || busy === "check"} onClick={() => setQuote(null)}>
              Cancel
            </button>
          </div>
          {!eth ? <p className="hint">No browser wallet was found. Open Threadsium in your wallet's browser to pay.</p> : null}
        </div>
      )}

      {pending ? (
        <p className="premium-notice">
          {note || "Checking your payment…"}{" "}
          <a href={explorerTx(pending.txHash)} target="_blank" rel="noopener noreferrer">
            View transaction <IconExternal size={12} />
          </a>
          {busy !== "check" ? (
            <>
              {" "}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void confirm(pending.txHash, pending.quoteId)}>
                Check again
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <details className="pay-recover">
        <summary>Already sent a payment? Enter its transaction hash</summary>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            const h = hash.trim();
            const p: Pending = { txHash: h, quoteId: null, tier: "premium" };
            writePending(p);
            setPending(p);
            void confirm(h, null);
          }}
        >
          <input className="field mono" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={66} aria-label="Transaction hash" />
          <button type="submit" className="btn btn-ghost" disabled={!/^0x[0-9a-fA-F]{64}$/.test(hash.trim()) || !!busy}>
            Check
          </button>
        </form>
        <p className="hint">The payment must come from your verified wallet and land while one of your price quotes was open.</p>
      </details>
    </section>
  );
}
