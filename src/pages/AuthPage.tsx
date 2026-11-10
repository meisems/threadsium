import React, { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthUser, api } from "../lib/api";
import { AvatarPicker } from "../components/AvatarPicker";
import { ThreadsiumMark } from "../components/brand";
import { ThemeControl } from "../components/ThemeControl";

export function AuthPage({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarId, setAvatarId] = useState("kinepip-samurai");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const res = await api.login({ username, password });
        onAuthenticated(res.user);
        navigate("/app");
      } else {
        const res = await api.register({
          username,
          password,
          displayName: displayName.trim() || username.trim(),
          avatarId,
        });
        onAuthenticated(res.user);
        navigate("/app");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="landing-header">
        <Link to="/" className="landing-brand-row">
          <ThreadsiumMark size={30} />
          <span className="landing-brand-title">Threadsium</span>
        </Link>
        <div className="landing-nav-actions">
          <Link to="/app" className="btn btn-ghost btn-sm">
            Browse as Guest
          </Link>
          <ThemeControl />
        </div>
      </header>

      <main className="auth-card-wrap">
        <section className="auth-card" aria-label="Account authentication">
          <div className="auth-card-head">
            <h1>
              {mode === "login"
                ? "Sign in to Threadsium"
                : "Claim your Elysium 99901 Handle"}
            </h1>
            <p className="muted-note">
              Server-verified PBKDF2-SHA256 credentials + HttpOnly session cookie. No seed phrase required.
            </p>
          </div>

          <div className="tabs-row">
            <button
              type="button"
              className={`tab-btn ${mode === "login" ? "is-active" : ""}`}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`tab-btn ${mode === "register" ? "is-active" : ""}`}
              onClick={() => {
                setMode("register");
                setError(null);
              }}
            >
              Create Handle
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span className="field-label">Username (3–20 alphanumeric / _)</span>
              <input
                type="text"
                className="text-input"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]{3,20}"
                placeholder="e.g. hype_operator"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </label>

            {mode === "register" && (
              <label className="form-field">
                <span className="field-label">Display Name</span>
                <input
                  type="text"
                  className="text-input"
                  maxLength={40}
                  placeholder="e.g. HYPE Operator"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            )}

            <label className="form-field">
              <span className="field-label">Password (minimum 6 characters)</span>
              <input
                type="password"
                className="text-input"
                required
                minLength={6}
                maxLength={128}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            {mode === "register" && (
              <div className="form-field">
                <span className="field-label">Select Operator Avatar</span>
                <AvatarPicker
                  selectedId={avatarId}
                  onSelectPreset={setAvatarId}
                  allowUpload={false}
                />
              </div>
            )}

            {error && <div className="form-error-banner">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={loading}
            >
              {loading
                ? "Authenticating…"
                : mode === "login"
                ? "Sign In"
                : "Create Account & Enter Trench"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
