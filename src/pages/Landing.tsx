import React from "react";
import { Link } from "react-router";
import "./landing.css";
import { Mark } from "../components/brand";
import { ThemeControl } from "../components/ThemeControl";
import { CHAIN } from "../config/chain";
import { useApp } from "../state";

/* ───────── landing ─────────
   The signed-out front door, laid out the way X, Threads and Facebook lay out theirs: the mark large on
   one side, a short "join" panel on the other (create an account, sign in, or just read), and a row of
   plain links at the bottom. The one thing that is ours is the backdrop: a studio plate generated with
   Nano Banana in Gemini (public/landing/hero-bg*.webp), shown in grayscale under the site's monochrome
   palette, one plate for the dark theme and one for the light theme. */

export function Landing(): React.ReactElement {
  const { user, block, hypeUsd } = useApp();
  const year = new Date().getFullYear();

  return (
    <div className="gate">
      <div className="gate-plate" aria-hidden="true" />
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <main id="main" className="gate-main">
        <div className="gate-mark">
          <Mark size={360} />
        </div>

        <div className="gate-panel">
          <span className="gate-mark-small" aria-hidden="true">
            <Mark size={44} />
          </span>
          <h1 className="gate-title">Where Elysium talks.</h1>
          <h2 className="gate-sub">{user ? "Welcome back." : "Join today."}</h2>

          <div className="gate-actions">
            {user ? (
              <>
                <Link className="gate-btn gate-btn-primary" to="/app">
                  Continue as @{user.username}
                </Link>
                <Link className="gate-btn" to={`/app/u/${user.username}`}>
                  Your profile
                </Link>
              </>
            ) : (
              <>
                <Link className="gate-btn gate-btn-primary" to="/auth?mode=new">
                  Create account
                </Link>
                <div className="gate-or" role="separator">
                  <span>or</span>
                </div>
                <Link className="gate-btn" to="/app">
                  Read the feed first
                </Link>
                <p className="gate-fine">
                  A username and a wallet, no email. No wallet? One is made in your browser, and only you hold its key. By joining you agree to the rules in the <Link to="/docs">help pages</Link>, including how{" "}
                  <Link to="/docs/privacy">your data</Link> is kept.
                </p>
                <p className="gate-have">Already have an account?</p>
                <Link className="gate-btn gate-btn-outline" to="/auth">
                  Sign in
                </Link>
              </>
            )}
          </div>

          <p className="gate-live">
            <span className={`chain-dot${block ? " is-live" : ""}`} aria-hidden="true" />
            <span>
              Elysium · Chain {CHAIN.id}
              {block ? ` · Block #${block.toLocaleString("en-US")}` : ""}
              {hypeUsd ? ` · HYPE $${hypeUsd.toFixed(2)}` : ""}
            </span>
          </p>
        </div>
      </main>

      <footer className="gate-foot">
        <nav aria-label="Footer">
          <Link to="/docs/overview">About</Link>
          <Link to="/docs">Help</Link>
          <Link to="/docs/sync">Embed a room</Link>
          <Link to="/docs/privacy">Privacy</Link>
          <Link to="/docs/limits">Limits</Link>
          <Link to="/docs/brand">Brand</Link>
          <a href={CHAIN.explorer} target="_blank" rel="noopener noreferrer">
            Block explorer
          </a>
          <span className="gate-theme">
            <ThemeControl compact />
          </span>
        </nav>
        <p>© {year} Threadsium. A community project for Elysium, not run by Kinetiq. Nothing here is financial advice.</p>
      </footer>
    </div>
  );
}
