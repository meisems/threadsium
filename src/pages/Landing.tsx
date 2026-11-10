import React from "react";
import { Link } from "react-router";
import { AuthUser, DirectoryToken } from "../lib/api";
import { ThreadsiumMark } from "../components/brand";
import { ThemeControl } from "../components/ThemeControl";
import { TokenMark } from "../lib/avatars";
import { fmtCompact, fmtPrice, shortAddr } from "../lib/format";

export function Landing({
  user,
  directory,
  hypeUsd,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
  hypeUsd: number;
}): React.ReactElement {
  const featured = directory.slice(0, 7);

  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-brand-row">
          <ThreadsiumMark size={34} />
          <div>
            <span className="landing-brand-title">Threadsium</span>
            <span className="landing-brand-tag">Elysium 99901 Social Layer</span>
          </div>
        </div>

        <nav className="landing-nav-actions" aria-label="Landing navigation">
          <span className="network-pill">
            <span className="pulse-dot" />
            Chain 99901 · provisional · HYPE ${hypeUsd.toFixed(2)}
          </span>
          <Link to="/docs" className="btn btn-ghost btn-sm">
            Docs
          </Link>
          <ThemeControl />
          <Link to="/app" className="btn btn-primary btn-sm">
            {user ? `Enter App (@${user.username})` : "Launch Trench Feed"}
          </Link>
        </nav>
      </header>

      <main className="landing-main">
        <section className="hero-section">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <span>DEDICATED WEB3 SOCIAL &amp; TOKEN TRENCH FOR ELYSIUM</span>
            </div>
            <h1 className="hero-headline">
              Every 99901 token, pool, and operator in one live social terminal.
            </h1>
            <p className="hero-lead">
              Threadsium weaves real-time social threads, nested token rooms, community star ratings, bullish/bearish sentiment, and native on-chain Uniswap V3 &amp; V4 swap charts directly onto <strong>Elysium (chain ID 99901 · provisional)</strong>.
            </p>

            <div className="hero-cta-row">
              <Link to="/app" className="btn btn-primary btn-lg">
                Open Trench Terminal →
              </Link>
              {!user && (
                <Link to="/auth" className="btn btn-secondary btn-lg">
                  Claim Operator Handle
                </Link>
              )}
              <Link to="/docs" className="btn btn-ghost btn-lg">
                Architecture &amp; Quotas
              </Link>
            </div>

            <div className="hero-metrics-strip">
              <div className="hero-metric">
                <span className="hero-metric-val">99901</span>
                <span className="hero-metric-lbl">Chain ID (0x1863d)</span>
              </div>
              <div className="hero-metric">
                <span className="hero-metric-val">13</span>
                <span className="hero-metric-lbl">V3 + V4 DEX Venues</span>
              </div>
              <div className="hero-metric">
                <span className="hero-metric-val">{directory.length}</span>
                <span className="hero-metric-lbl">Indexed Tokens</span>
              </div>
              <div className="hero-metric">
                <span className="hero-metric-val">HYPE</span>
                <span className="hero-metric-lbl">Native Gas &amp; Quote</span>
              </div>
            </div>
          </div>

          <div className="hero-showcase-card">
            <div className="showcase-head">
              <span className="showcase-title">Live 99901 Token Rooms</span>
              <span className="badge badge-emerald">On-Chain Indexed</span>
            </div>
            <div className="showcase-token-list">
              {featured.map((t) => (
                <Link
                  key={t.address}
                  to={`/app/token/${t.address}`}
                  className="showcase-token-row"
                >
                  <TokenMark address={t.address} symbol={t.symbol} size={38} />
                  <div className="showcase-token-info">
                    <div className="showcase-token-top">
                      <span className="font-semibold">${t.symbol}</span>
                      <span className="muted-note">{t.name}</span>
                      <span className="badge badge-subtle">{t.launchpad}</span>
                    </div>
                    <div className="showcase-token-sub">
                      <span className="font-mono">{shortAddr(t.address, 6, 4)}</span>
                      <span>·</span>
                      <span>
                        {t.priceHype
                          ? `${fmtPrice(t.priceHype)} HYPE`
                          : t.tagline.slice(0, 38)}
                      </span>
                    </div>
                  </div>
                  <div className="showcase-token-right">
                    <span className="badge badge-gold">
                      ★ {t.ratingCount > 0 ? t.ratingAvg.toFixed(1) : "—"}
                    </span>
                    <span className="showcase-liq">
                      {t.reserveWhype > 0
                        ? `${fmtCompact(t.reserveWhype, 1)} WHYPE`
                        : "Room →"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="features-grid-section">
          <div className="feature-pillar-card">
            <span className="pillar-kicker">01 / AUTO-LINKED TICKERS &amp; CONTRACTS</span>
            <h3>Mention $KNTQ, $BOXA, $KLEOS, or any 0x address</h3>
            <p>
              Every thread, quote, or reply automatically detects `$TICKER` symbols, 40-hex `0x` contract addresses, and `#hashtags`, routing straight into dedicated token rooms.
            </p>
          </div>

          <div className="feature-pillar-card">
            <span className="pillar-kicker">02 / NATIVE V3 &amp; V4 SWAP CHARTS</span>
            <h3>Zero external chart iframes — pure 99901 RPC</h3>
            <p>
              Token pages index `PoolCreated`, `Initialize`, and `Swap` events across 7 Uniswap V3 factories and 6 V4 PoolManagers on Elysium 99901 to render real-time OHLCV candles.
            </p>
          </div>

          <div className="feature-pillar-card">
            <span className="pillar-kicker">03 / HOLDER TIERS &amp; SENTIMENT</span>
            <h3>Whale, Holder, and Spectator verification</h3>
            <p>
              Link and EIP-191 sign your 99901 wallet to display verified on-chain holder tiers (`≥ 1%` Whale, `&gt; 0` Holder), cast 1–5 star ratings, and vote Bullish or Bearish.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <span>Threadsium · Built for Elysium 99901 (provisional network profile)</span>
        </div>
        <div className="landing-footer-links">
          <Link to="/app">App</Link>
          <Link to="/docs">Documentation</Link>
          <a href="https://elyscan.live" target="_blank" rel="noopener noreferrer">
            Elyscan ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
