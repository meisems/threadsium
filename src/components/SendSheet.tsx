// Send / tip: native HYPE or any ERC-20 straight to a person's linked wallet, signed in the sender's own wallet.
// Once mined, the transfer is recorded as a direct message; the server reads it back from the receipt first.
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { explorerAddress, explorerTx } from "../config/chain";
import { api, type Message, type UserLite } from "../lib/api";
import { shortAddr } from "../lib/format";
import {
  NATIVE_ADDRESS,
  amountInput,
  balanceOf,
  connectedAccount,
  formatAmount,
  parseAmount,
  requestAccount,
  sendTransaction,
  tokenInfo,
  transferData,
  waitForReceipt,
  walletError,
  walletProvider,
  type TokenInfo,
} from "../lib/wallet";
import { useApp } from "../state";
import { Avatar } from "./Avatar";
import { IconExternal, IconVerified } from "./icons";
import type { SendContext } from "./SendAction";
import { Sheet } from "./Sheet";

type Phase = "idle" | "wallet" | "sign" | "mining" | "record" | "done";

export default function SendSheet({
  to,
  context,
  onClose,
  onRecorded,
}: {
  to: UserLite;
  context: SendContext;
  onClose: () => void;
  onRecorded?: (m: Message) => void;
}): React.ReactElement {
  const { tokens, refreshCounts } = useApp();
  const [account, setAccount] = useState<string | null>(null);
  const [assetKey, setAssetKey] = useState<string>(NATIVE_ADDRESS);
  const [custom, setCustom] = useState("");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<Message | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const hasWallet = !!walletProvider();
  const recipient = to.walletAddress ?? "";

  const options = useMemo(
    () =>
      [...tokens]
        .sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth)
        .slice(0, 40)
        .map((t) => ({ address: t.address, label: `$${t.symbol}` })),
    [tokens],
  );
  const asset = assetKey === "custom" ? (/^0x[0-9a-fA-F]{40}$/.test(custom.trim()) ? custom.trim().toLowerCase() : null) : assetKey;

  useEffect(() => {
    connectedAccount().then(setAccount);
  }, []);

  useEffect(() => {
    setInfo(null);
    setBalance(null);
    if (!asset) return;
    let live = true;
    tokenInfo(asset).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [asset]);

  useEffect(() => {
    if (!asset || !account) return;
    let live = true;
    balanceOf(asset, account).then((b) => live && setBalance(b));
    return () => {
      live = false;
    };
  }, [asset, account, phase === "done"]);

  const raw = info ? parseAmount(amount, info.decimals) : null;
  const tooMuch = raw !== null && balance !== null && raw > balance;
  const busy = phase !== "idle" && phase !== "done";
  const contextNote =
    context.kind === "post" && context.postId
      ? `For your post: /app/post/${context.postId}`
      : context.kind === "reply" && context.postId
        ? `For your reply: /app/post/${context.postId}`
        : "";

  const record = async (txHash: string) => {
    setPhase("record");
    setRecordError(null);
    const fullNote = [note.trim(), contextNote].filter(Boolean).join("\n");
    // The receipt is usually there already; a node that lags gets two more tries.
    for (let i = 0; i < 3; i++) {
      try {
        const r = await api.recordTransfer(to.username, { hash: txHash, token: asset === NATIVE_ADDRESS ? null : asset, note: fullNote || undefined });
        setRecorded(r.message);
        onRecorded?.(r.message);
        refreshCounts();
        setPhase("done");
        return;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 409 && /mined/i.test((e as Error).message) && i < 2) {
          await new Promise((res) => setTimeout(res, 2000));
          continue;
        }
        setRecordError((e as Error).message);
        setPhase("done");
        return;
      }
    }
  };

  const send = async () => {
    if (!asset || !info || raw === null || busy) return;
    setError(null);
    let sent: string | null = null;
    try {
      setPhase("wallet");
      const from = account ?? (await requestAccount());
      setAccount(from);
      setPhase("sign");
      const tx = asset === NATIVE_ADDRESS ? { to: recipient, value: raw } : { to: asset, data: transferData(recipient, raw) };
      sent = await sendTransaction(from, tx);
      setHash(sent);
      setPhase("mining");
      const receipt = await waitForReceipt(sent);
      if (receipt.status !== "success") throw new Error("The transfer reverted on chain, so nothing was sent.");
      await record(sent);
    } catch (e) {
      setError(walletError(e));
      setPhase(sent ? "done" : "idle");
    }
  };

  const symbol = info?.symbol ?? (asset === NATIVE_ADDRESS ? "HYPE" : "token");

  return (
    <Sheet title={`Send to @${to.username}`} onClose={busy ? () => undefined : onClose}>
      <div className="send-to">
        <Avatar user={to} size={40} />
        <div className="send-to-main">
          <strong>{to.displayName}</strong>
          <a href={explorerAddress(recipient)} target="_blank" rel="noopener noreferrer" className="mono send-to-addr" title={recipient}>
            {shortAddr(recipient, 8, 6)} <IconExternal size={13} />
          </a>
        </div>
        {to.walletVerified ? (
          <span className="chip">
            <IconVerified size={14} /> verified
          </span>
        ) : (
          <span className="chip chip-warn" title="The address was pasted, not proven with a signature.">
            not verified
          </span>
        )}
      </div>
      {!to.walletVerified ? (
        <p className="hint">@{to.username} pasted this address without signing for it. Check it with them before sending a large amount.</p>
      ) : null}

      {phase === "done" && hash ? (
        <div className="send-done" role="status">
          {error ? (
            <p className="form-error">{error}</p>
          ) : (
            <p>
              <strong>
                Sent {raw !== null && info ? formatAmount(raw, info.decimals) : ""} {symbol} to @{to.username}.
              </strong>
            </p>
          )}
          <a className="chip" href={explorerTx(hash)} target="_blank" rel="noopener noreferrer">
            View on elyscan <IconExternal size={13} />
          </a>
          {recorded ? (
            <p className="hint">
              Added to your <Link to={`/app/messages/${to.username}`}>conversation with @{to.username}</Link>.
            </p>
          ) : recordError ? (
            <div className="notice notice-error">
              <p>The transfer went through, but it could not be added to your messages: {recordError}</p>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void record(hash)}>
                Try again
              </button>
            </div>
          ) : null}
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="label" htmlFor="send-asset">
            Asset
          </label>
          <select id="send-asset" className="field" value={assetKey} onChange={(e) => setAssetKey(e.target.value)} disabled={busy}>
            <option value={NATIVE_ADDRESS}>HYPE (native)</option>
            {options.map((o) => (
              <option key={o.address} value={o.address}>
                {o.label}
              </option>
            ))}
            <option value="custom">Another token (paste its address)</option>
          </select>
          {assetKey === "custom" ? (
            <input className="field mono field-gap" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0x… token contract" spellCheck={false} maxLength={42} aria-label="Token contract address" disabled={busy} />
          ) : null}
          {asset && !info && assetKey !== NATIVE_ADDRESS ? <p className="hint">Reading the token from Elysium…</p> : null}

          <label className="label" htmlFor="send-amount">
            Amount
          </label>
          <div className="field-row">
            <input
              id="send-amount"
              className="field mono"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
            <span className="send-unit">{symbol}</span>
          </div>
          <p className="hint">
            {account ? (
              <>
                Balance:{" "}
                {balance !== null && info ? (
                  <button type="button" className="link-btn" onClick={() => setAmount(amountInput(balance, info.decimals))} disabled={busy}>
                    {formatAmount(balance, info.decimals)} {symbol}
                  </button>
                ) : (
                  "…"
                )}
                {asset === NATIVE_ADDRESS ? " · keep a little HYPE for gas" : ""}
              </>
            ) : hasWallet ? (
              "Your wallet connects when you press Send."
            ) : (
              "No browser wallet was found on this device."
            )}
          </p>

          <label className="label" htmlFor="send-note">
            Note <span className="label-soft">(optional, shown in your messages)</span>
          </label>
          <input id="send-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Thanks for the call" disabled={busy} />

          {tooMuch ? <p className="form-error">That is more than your wallet holds.</p> : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block btn-large" disabled={!hasWallet || !asset || !info || raw === null || tooMuch || busy}>
            {phase === "wallet"
              ? "Connecting your wallet…"
              : phase === "sign"
                ? "Confirm in your wallet…"
                : phase === "mining"
                  ? "Waiting for the block…"
                  : phase === "record"
                    ? "Adding it to your messages…"
                    : raw !== null && info
                      ? `Send ${formatAmount(raw, info.decimals)} ${symbol}`
                      : "Send"}
          </button>
          <p className="hint send-fine">
            Your wallet signs a plain {asset === NATIVE_ADDRESS ? "HYPE transfer" : "token transfer"} on Elysium (chain 99901) to {shortAddr(recipient)}. Threadsium
            never sees your keys and takes no fee. Transfers cannot be undone.
          </p>
        </form>
      )}
    </Sheet>
  );
}
