import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { WEAVES, WeavePatch } from "../components/Avatar";
import { Wordmark } from "../components/brand";
import { NewWallet } from "../components/NewWallet";
import { ThemeControl } from "../components/ThemeControl";
import { WalletChooser } from "../components/WalletChooser";
import { api, type Me } from "../lib/api";
import { shortAddr } from "../lib/format";
import { prepareImage } from "../lib/image";
import { walletSignIn, type WalletSigner } from "../lib/siwe";
import { useApp } from "../state";

type Ticket = { signupToken: string; address: string };

export function Auth(): React.ReactElement {
  const { user, setUser, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only same-site app paths are accepted as a return address.
  const nextRaw = params.get("next") ?? "";
  const next = /^\/app(\/[A-Za-z0-9_\-/?=&%#.]*)?$/.test(nextRaw) ? nextRaw : "/app";

  const [mode, setMode] = useState<"in" | "new">(params.get("mode") === "new" ? "new" : "in");
  // Creating an account: profile first, then which wallet, then (for a new wallet) its recovery phrase.
  const [stage, setStage] = useState<"profile" | "wallet" | "newwallet">("profile");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [weave, setWeave] = useState(WEAVES[0].id);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const photoInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const nameOk = /^[A-Za-z0-9_]{3,20}$/.test(username);

  const switchMode = (m: "in" | "new") => {
    setMode(m);
    setStage("profile");
    setTicket(null);
    setError("");
    setNotice("");
  };

  const pickPhoto = (f: File | undefined) => {
    if (photoInput.current) photoInput.current.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return setError("Only PNG, JPEG, WebP and GIF images can be uploaded.");
    setError("");
    setPhoto(f);
    setPhotoUrl(URL.createObjectURL(f));
  };

  const done = (u: Me, message: string) => {
    setUser(u);
    toast(message);
    navigate(next, { replace: true });
  };

  /** Turns a sign-up ticket into an account, then uploads the chosen photo (the woven patch stays if that fails). */
  const createAccount = async (t: Ticket) => {
    let u = await api.siweRegister(t.signupToken, username.trim(), weave);
    setTicket(null);
    if (photo) {
      try {
        const limits = await api.limits().catch(() => null);
        const blob = await prepareImage(photo, 512, limits?.media.avatar ?? 1024 * 1024);
        u = (await api.upload(blob, "avatar")).user;
      } catch (err) {
        toast(`Your account is ready, but the photo was not uploaded: ${(err as Error).message} Try again in Settings.`, "error");
      }
    }
    done(u, `Welcome, @${u.username}`);
  };

  /** Creating an account with a wallet: sign in with it, and finish with the username chosen in the first step. */
  const signUpWith = async (signer: WalletSigner) => {
    setError("");
    setBusy(true);
    try {
      const r = await walletSignIn(signer);
      if ("user" in r) return done(r.user, `This wallet already has an account. Signed in as @${r.user.username}`);
      setTicket(r);
      try {
        await createAccount(r);
      } catch (err) {
        setStage("profile");
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const signInWith = async (signer: WalletSigner) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await walletSignIn(signer);
      if ("user" in r) return done(r.user, "Signed in");
      setTicket(r);
      setNotice(
        signer.kind === "local"
          ? `No account uses the wallet ${shortAddr(r.address, 6, 4)} yet. If you expected one, check the words and their order. Otherwise pick a username to create an account with it.`
          : `No account uses ${shortAddr(r.address, 6, 4)} yet. Pick a username to create one with this wallet.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!nameOk) return setError("Usernames are 3 to 20 letters, numbers or underscores.");
    if (!ticket) return setStage("wallet");
    setBusy(true);
    try {
      await createAccount(ticket);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const passwordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      done(await api.login(username.trim(), password), "Signed in");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;

  const profileForm = (
    <form onSubmit={submitProfile} noValidate>
      {ticket ? (
        <p className="chip mono wallet-ticket">
          Wallet {shortAddr(ticket.address, 8, 6)}
          <span className="chip-note">signed</span>
        </p>
      ) : null}
      <label className="label" htmlFor="auth-user">
        Username
      </label>
      <input
        id="auth-user"
        className="field"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={20}
        required
        aria-describedby="auth-user-hint"
      />
      <p className="hint" id="auth-user-hint">
        3 to 20 letters, numbers or underscores. It cannot be changed later.
      </p>

      <fieldset className="weave-pick">
        <legend className="label">Profile picture</legend>
        <div className="photo-pick">
          <span className="avatar" style={{ width: 64, height: 64 }}>
            {photoUrl ? <img src={photoUrl} alt="" width={64} height={64} /> : <WeavePatch seed={username || "threadsium"} preset={weave} size={64} />}
          </span>
          <div className="settings-media-actions">
            <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => photoInput.current?.click()}>
              {photo ? "Change photo" : "Upload a photo"}
            </button>
            {photo ? (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => (setPhoto(null), setPhotoUrl(null))}>
                Use the woven patch
              </button>
            ) : null}
          </div>
        </div>
        <p className="hint">
          {photo
            ? "Resized in your browser and uploaded once your account exists. If it cannot be uploaded, your woven patch is used."
            : "Without a photo, your picture is a woven patch made from your username. Pick its colours. You can change either later in Settings."}
        </p>
        <div className="weave-options">
          {WEAVES.map((w) => (
            <label key={w.id} className={`weave-option${weave === w.id ? " is-on" : ""}`}>
              <input type="radio" name="weave" value={w.id} checked={weave === w.id} onChange={() => setWeave(w.id)} />
              <span className="avatar" style={{ width: 48, height: 48 }}>
                <WeavePatch seed={username || "threadsium"} preset={w.id} size={48} />
              </span>
              <span>{w.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {errorBox}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username}>
        {busy ? "Creating your account…" : ticket ? "Create account" : "Continue"}
      </button>
      {ticket && mode === "in" ? (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => switchMode("in")}>
          Back to sign in
        </button>
      ) : null}
    </form>
  );

  let body: React.ReactNode;
  if (ticket || (mode === "new" && stage === "profile")) {
    body = (
      <>
        {notice ? <p className="notice auth-notice">{notice}</p> : null}
        {profileForm}
      </>
    );
  } else if (mode === "new" && stage === "wallet") {
    body = (
      <div>
        <h2 className="step-title">Your wallet</h2>
        <p className="hint">Your account is tied to a wallet address. You sign in by signing a message with it. That is free and sends no transaction.</p>
        <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => (setStage("newwallet"), setError(""))}>
          Make me a new wallet
        </button>
        <p className="auth-divider">
          <span>or use a wallet you already have</span>
        </p>
        <WalletChooser action="Continue" busy={busy} onSigner={signUpWith} />
        {errorBox}
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setStage("profile")}>
          Back
        </button>
      </div>
    );
  } else if (mode === "new") {
    body = (
      <>
        <NewWallet onReady={signUpWith} onCancel={() => setStage("wallet")} />
        {errorBox}
      </>
    );
  } else {
    body = (
      <>
        <WalletChooser action="Sign in" busy={busy} onSigner={signInWith} />
        <p className="auth-divider">
          <span>or with a username and password</span>
        </p>
        <form onSubmit={passwordSignIn} noValidate>
          <label className="label" htmlFor="auth-user">
            Username
          </label>
          <input
            id="auth-user"
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            required
          />
          <label className="label" htmlFor="auth-pass">
            Password
          </label>
          <div className="field-row">
            <input
              id="auth-pass"
              className="field"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              maxLength={128}
              required
            />
            <button type="button" className="btn btn-ghost btn-small" aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {errorBox}
          <button type="submit" className="btn btn-ink btn-block" disabled={busy || !username || !password}>
            {busy ? "Signing in…" : "Sign in with password"}
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="auth">
      <header className="auth-top">
        <Link to="/" aria-label="Threadsium home">
          <Wordmark size={28} />
        </Link>
        <ThemeControl compact />
      </header>
      <main className="auth-card" id="main">
        <h1>{ticket ? "Finish your account" : mode === "new" ? "Create your account" : "Sign in"}</h1>
        <p className="auth-lede">
          {ticket
            ? "Your wallet's signature checked out. Pick a username and a picture to finish."
            : mode === "new"
            ? "A username and a wallet. No email. If you have no wallet, one is made for you in this browser and only you get its key."
            : "Sign with your wallet, or use the username and password of an older account."}
        </p>

        <div className="segmented segmented-wide" role="group" aria-label="Sign in or create an account">
          <button type="button" className={mode === "in" ? "is-on" : ""} aria-pressed={mode === "in"} onClick={() => switchMode("in")}>
            Sign in
          </button>
          <button type="button" className={mode === "new" ? "is-on" : ""} aria-pressed={mode === "new"} onClick={() => switchMode("new")}>
            Create account
          </button>
        </div>

        {body}

        <p className="auth-foot">
          <Link to="/app">Look around without an account</Link>
          <Link to="/docs#wallet">How wallet accounts work</Link>
          <Link to="/docs#privacy">How your data is handled</Link>
        </p>
      </main>
    </div>
  );
}
