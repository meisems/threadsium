// Making a wallet in this browser for someone who has none: show the 12 words once, check that they were written down,
// then (if the visitor chooses) keep an encrypted copy here. Nothing in this component sends anything anywhere.
import React, { useEffect, useMemo, useState } from "react";
import type { WalletSigner } from "../lib/siwe";

/** Whether "keep an encrypted copy in this browser" starts ticked. An owner decision; see Docs › Linking a wallet. */
export const KEEP_COPY_DEFAULT = true;

/**
 * The private key of a phrase's first account, hidden until asked for. Same wallet as the words, for apps that import a
 * key instead. Computed in the page only when opened, and dropped again when closed.
 */
export function PrivateKeyReveal({ phrase }: { phrase: string }): React.ReactElement {
  const [key, setKey] = useState<string | null>(null);
  return (
    <details
      className="pk-reveal"
      onToggle={async (e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open;
        if (!open) return setKey(null);
        const lw = await import("../lib/localWallet");
        setKey(lw.privateKeyOfPhrase(phrase));
      }}
    >
      <summary>Show the private key instead</summary>
      <p className="hint">
        Some apps import a private key rather than words. This key is the same wallet as the 12 words. Treat it exactly like them: anyone who has it controls
        the wallet.
      </p>
      {key ? <code className="pk-value mono">{key}</code> : null}
    </details>
  );
}

function pickPositions(n: number, count: number): number[] {
  const out = new Set<number>();
  const r = new Uint32Array(8);
  while (out.size < count) {
    crypto.getRandomValues(r);
    for (const v of r) if (out.size < count) out.add(v % n);
  }
  return [...out].sort((a, b) => a - b);
}

export function NewWallet({ onReady, onCancel }: { onReady: (signer: WalletSigner) => Promise<void>; onCancel: () => void }): React.ReactElement {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [stage, setStage] = useState<"show" | "check" | "keep">("show");
  const [wrote, setWrote] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [keep, setKeep] = useState(KEEP_COPY_DEFAULT);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    import("../lib/localWallet").then((lw) => live && setPhrase(lw.newRecoveryPhrase()));
    return () => {
      live = false;
    };
  }, []);

  const words = phrase ? phrase.split(" ") : [];
  const ask = useMemo(() => (words.length ? pickPositions(words.length, 3) : []), [phrase]);
  const checked = ask.length > 0 && ask.every((i) => (answers[i] ?? "").trim().toLowerCase() === words[i]);

  if (!phrase) return <p className="hint">Making your wallet…</p>;

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (keep && pw.length < 8) return setError("Use at least 8 characters for this password.");
    if (keep && pw !== pw2) return setError("The two passwords are different.");
    setBusy(true);
    try {
      const lw = await import("../lib/localWallet");
      if (keep) lw.saveWallet(await lw.encryptPhrase(phrase, pw));
      const signer = lw.signerFromPhrase(phrase);
      setPw("");
      setPw2("");
      await onReady(signer);
      setPhrase(null);
    } catch (err) {
      setError((err as Error).message || "The wallet could not be set up.");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "show") {
    return (
      <div className="new-wallet">
        <h2 className="step-title">Your recovery phrase</h2>
        <p>
          These 12 words are your new wallet and the key to this account. They were made in this browser just now. Threadsium never sees them and cannot show
          them to you again or reset them.
        </p>
        <ol className="phrase-grid" aria-label="Recovery phrase, 12 words in order">
          {words.map((w, i) => (
            <li key={i}>
              <span className="phrase-n">{i + 1}</span>
              <span className="mono">{w}</span>
            </li>
          ))}
        </ol>
        <ul className="hint-list">
          <li>Write them on paper, in order, and keep it somewhere safe. Avoid screenshots and cloud notes.</li>
          <li>Anyone who has these words controls this wallet, this account and any funds sent to its address.</li>
          <li>The same words work in MetaMask, Rabby and most other wallets (“import a wallet”).</li>
        </ul>
        <PrivateKeyReveal phrase={phrase} />
        <label className="switch">
          <input type="checkbox" checked={wrote} onChange={(e) => setWrote(e.target.checked)} />
          <span>
            <strong>I wrote down all 12 words in order</strong>
          </span>
        </label>
        <div className="settings-row">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={!wrote} onClick={() => setStage("check")}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (stage === "check") {
    return (
      <form
        className="new-wallet"
        onSubmit={(e) => {
          e.preventDefault();
          if (checked) setStage("keep");
          else setError("Those words do not match. Look at your copy again.");
        }}
      >
        <h2 className="step-title">Check your copy</h2>
        <p>Type these words from what you wrote down.</p>
        {ask.map((i) => (
          <div key={i}>
            <label className="label" htmlFor={`check-${i}`}>
              Word {i + 1}
            </label>
            <input
              id={`check-${i}`}
              className="field mono"
              value={answers[i] ?? ""}
              onChange={(e) => (setAnswers((a) => ({ ...a, [i]: e.target.value })), setError(""))}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        ))}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="settings-row">
          <button type="button" className="btn btn-ghost" onClick={() => (setStage("show"), setError(""))}>
            Show the words again
          </button>
          <button type="submit" className="btn btn-primary" disabled={ask.some((i) => !(answers[i] ?? "").trim())}>
            Check
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="new-wallet" onSubmit={finish}>
      <h2 className="step-title">Signing in next time</h2>
      <label className="switch">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        <span>
          <strong>Keep an encrypted copy in this browser</strong>
          <span className="hint">
            Then a password unlocks it here instead of typing 12 words. The copy is locked with this password (PBKDF2 and AES-GCM) and never leaves this
            browser. Anyone who can use this browser profile and guesses the password could unlock it, so pick a strong one. Clearing site data removes it;
            your paper copy still works.
          </span>
        </span>
      </label>
      {keep ? (
        <>
          <label className="label" htmlFor="keep-pw">
            Password for this browser
          </label>
          <input id="keep-pw" className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} maxLength={256} />
          <label className="label" htmlFor="keep-pw2">
            Same password again
          </label>
          <input id="keep-pw2" className="field" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} maxLength={256} />
          <p className="hint">At least 8 characters. It is not your Threadsium password and it is never sent anywhere, so it cannot be reset.</p>
        </>
      ) : (
        <p className="hint">Without a copy here, you sign in by typing your 12 words. Sessions last 14 days.</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Signing in with your new wallet…" : "Create my account"}
      </button>
    </form>
  );
}
