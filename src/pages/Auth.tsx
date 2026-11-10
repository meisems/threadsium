import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { WEAVES, WeavePatch } from "../components/Avatar";
import { Wordmark } from "../components/brand";
import { ThemeControl } from "../components/ThemeControl";
import { api } from "../lib/api";
import { useApp } from "../state";

export function Auth(): React.ReactElement {
  const { user, setUser, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only same-site app paths are accepted as a return address.
  const nextRaw = params.get("next") ?? "";
  const next = /^\/app(\/[A-Za-z0-9_\-/?=&%#.]*)?$/.test(nextRaw) ? nextRaw : "/app";

  const [mode, setMode] = useState<"in" | "new">(params.get("mode") === "new" ? "new" : "in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [weave, setWeave] = useState(WEAVES[0].id);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user]);

  const nameOk = /^[A-Za-z0-9_]{3,20}$/.test(username);
  const passOk = password.length >= 8 && password.length <= 128;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (mode === "new" && !nameOk) return setError("Usernames are 3 to 20 letters, numbers or underscores.");
    if (mode === "new" && !passOk) return setError("Passwords need at least 8 characters.");
    setBusy(true);
    try {
      const u = mode === "new" ? await api.register(username.trim(), password, weave) : await api.login(username.trim(), password);
      setUser(u);
      toast(mode === "new" ? `Welcome, @${u.username}` : "Signed in");
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <header className="auth-top">
        <Link to="/" aria-label="Threadsium home">
          <Wordmark size={28} />
        </Link>
        <ThemeControl compact />
      </header>
      <main className="auth-card" id="main">
        <h1>{mode === "new" ? "Create your account" : "Sign in"}</h1>
        <p className="auth-lede">
          {mode === "new"
            ? "A username and a password are all it takes. No email, and linking a wallet is optional."
            : "Use the username and password you signed up with."}
        </p>

        <div className="segmented segmented-wide" role="group" aria-label="Sign in or create an account">
          <button type="button" className={mode === "in" ? "is-on" : ""} aria-pressed={mode === "in"} onClick={() => (setMode("in"), setError(""))}>
            Sign in
          </button>
          <button type="button" className={mode === "new" ? "is-on" : ""} aria-pressed={mode === "new"} onClick={() => (setMode("new"), setError(""))}>
            Create account
          </button>
        </div>

        <form onSubmit={submit} noValidate>
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
            aria-describedby={mode === "new" ? "auth-user-hint" : undefined}
          />
          {mode === "new" ? (
            <p className="hint" id="auth-user-hint">
              3 to 20 letters, numbers or underscores. It cannot be changed later.
            </p>
          ) : null}

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
              autoComplete={mode === "new" ? "new-password" : "current-password"}
              maxLength={128}
              required
              aria-describedby={mode === "new" ? "auth-pass-hint" : undefined}
            />
            <button type="button" className="btn btn-ghost btn-small" aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {mode === "new" ? (
            <p className="hint" id="auth-pass-hint">
              At least 8 characters. There is no email on file, so a forgotten password cannot be recovered. Keep it in a password manager.
            </p>
          ) : null}

          {mode === "new" ? (
            <fieldset className="weave-pick">
              <legend className="label">Your weave</legend>
              <p className="hint">Your profile picture is a woven patch made from your username. Pick its colours; you can upload a photo later.</p>
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
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username || !password}>
            {busy ? (mode === "new" ? "Creating your account…" : "Signing in…") : mode === "new" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth-foot">
          <Link to="/app">Look around without an account</Link>
          <Link to="/docs#privacy">How your data is handled</Link>
        </p>
      </main>
    </div>
  );
}
