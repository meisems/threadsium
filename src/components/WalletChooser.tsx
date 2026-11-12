// Picks the wallet that signs: the visitor's own browser wallet, a wallet saved (encrypted) in this browser, or a
// recovery phrase (12 to 24 words) or private key typed in. Used to sign in and to confirm sensitive account changes.
// Whatever is chosen, only a signature leaves the page; the phrase, the key and the unlock password stay here.
import React, { useEffect, useMemo, useState } from "react";
import { shortAddr } from "../lib/format";
import type { Keystore } from "../lib/localWallet";
import { browserWalletSigner, hasBrowserWallet, type WalletSigner } from "../lib/siwe";

const loadLocal = () => import("../lib/localWallet");

export function walletErrorText(e: unknown): string {
  const err = e as { code?: number; message?: string; shortMessage?: string };
  if (err?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  if (err?.code === -32002) return "Your wallet already has a request open. Finish or close it there first.";
  return (err?.shortMessage || err?.message || "The wallet request failed.").slice(0, 220);
}

export function useSavedWallets(): [Keystore[], () => void] {
  const [tick, setTick] = useState(0);
  const list = useMemo(() => {
    try {
      const raw = localStorage.getItem("threadsium.wallets.v1");
      return raw ? ((JSON.parse(raw) as Keystore[]) ?? []).filter((k) => k && typeof k.address === "string") : [];
    } catch {
      return [];
    }
  }, [tick]);
  return [list, () => setTick((t) => t + 1)];
}

function SavedWalletUnlock({ store, busy, action, onSigner }: { store: Keystore; busy: boolean; action: string; onSigner: (s: WalletSigner) => Promise<void> }): React.ReactElement {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const id = `unlock-${store.address.slice(2, 10)}`;
  return (
    <form
      className="wallet-option"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setWorking(true);
        try {
          const lw = await loadLocal();
          const signer = lw.signerFromPhrase(await lw.decryptPhrase(store, password));
          setPassword("");
          await onSigner(signer);
        } catch (err) {
          setError(walletErrorText(err));
        } finally {
          setWorking(false);
        }
      }}
    >
      <label className="label" htmlFor={id}>
        Wallet saved in this browser <span className="mono">{shortAddr(store.address, 6, 4)}</span>
      </label>
      <div className="field-row">
        <input
          id={id}
          className="field"
          type="password"
          autoComplete="off"
          placeholder="Its password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={256}
        />
        <button type="submit" className="btn btn-ink" disabled={busy || working || !password}>
          {working ? "Unlocking…" : action}
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** 12 to 24 words, or 64 hex characters (with or without 0x): enough to try signing. */
function secretReady(text: string): boolean {
  const t = text.trim();
  return /^(0x)?[0-9a-f]{64}$/i.test(t) || t.split(/\s+/).length >= 12;
}

function PhraseEntry({ busy, action, onSigner }: { busy: boolean; action: string; onSigner: (s: WalletSigner) => Promise<void> }): React.ReactElement {
  const [phrase, setPhrase] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="wallet-option wallet-phrase">
      <summary>Use a recovery phrase or private key</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setWorking(true);
          try {
            const lw = await loadLocal();
            const signer = lw.signerFromSecret(phrase);
            setPhrase("");
            await onSigner(signer);
          } catch (err) {
            setError(walletErrorText(err));
          } finally {
            setWorking(false);
          }
        }}
      >
        <label className="label" htmlFor="phrase-entry">
          Recovery phrase (12 to 24 words) or private key
        </label>
        <textarea
          id="phrase-entry"
          className="field mono"
          rows={3}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="phrase-entry-hint"
        />
        <p className="hint" id="phrase-entry-hint">
          Paste the words with spaces between them, or the private key (64 characters, with or without 0x). It stays on this page; only a signature made
          with it is sent. Never type it into a site you reached from a link someone sent you.
        </p>
        <button type="submit" className="btn btn-ink" disabled={busy || working || !secretReady(phrase)}>
          {working ? "Signing…" : action}
        </button>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}

/**
 * Lists every way this visitor can sign. `expect` limits it to one address (confirming changes to an account), and a
 * signer for any other address is refused before anything is signed.
 */
export function WalletChooser({
  action,
  expect,
  busy = false,
  onSigner,
}: {
  action: string;
  expect?: string | null;
  busy?: boolean;
  onSigner: (s: WalletSigner) => Promise<void>;
}): React.ReactElement {
  const [saved] = useSavedWallets();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const want = expect?.toLowerCase() ?? null;
  const usable = want ? saved.filter((k) => k.address === want) : saved;
  // Some wallets inject window.ethereum after the page has rendered; look again when they announce it.
  const [injected, setInjected] = useState(hasBrowserWallet);
  useEffect(() => {
    if (injected) return;
    const recheck = () => setInjected(hasBrowserWallet());
    const t = window.setTimeout(recheck, 1500);
    window.addEventListener("ethereum#initialized", recheck, { once: true });
    window.addEventListener("eip6963:announceProvider", recheck, { once: true });
    window.addEventListener("focus", recheck);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("ethereum#initialized", recheck);
      window.removeEventListener("eip6963:announceProvider", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [injected]);

  const guarded = async (signer: WalletSigner) => {
    if (want && signer.address.toLowerCase() !== want) {
      throw new Error(`That is ${shortAddr(signer.address, 6, 4)}. Use the wallet linked to this account, ${shortAddr(want, 6, 4)}.`);
    }
    await onSigner(signer);
  };

  return (
    <div className="wallet-chooser">
      <div className="wallet-option">
        <button
          type="button"
          className="btn btn-primary btn-block-tight"
          disabled={busy || working || !injected}
          onClick={async () => {
            setError("");
            setWorking(true);
            try {
              await guarded(await browserWalletSigner());
            } catch (err) {
              setError(walletErrorText(err));
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? "Waiting for your wallet…" : `${action} with your browser wallet`}
        </button>
        {!injected ? <p className="hint">No browser wallet was found. Open Threadsium in your wallet's browser, or use one of the options below.</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {usable.map((k) => (
        <SavedWalletUnlock key={k.address} store={k} busy={busy || working} action={action} onSigner={guarded} />
      ))}
      <PhraseEntry busy={busy || working} action={action} onSigner={guarded} />
    </div>
  );
}
