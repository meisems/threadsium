import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { ThreadsiumMark } from "../components/brand";
import { ThemeControl } from "../components/ThemeControl";
import { ELYSIUM_CHAIN } from "../config/chain";
import { SEEDED_TOKENS } from "../config/tokens";
import { V3_VENUES } from "../config/venues";
import { V4_MANAGERS } from "../config/v4";

interface DocSection {
  id: string;
  title: string;
  kicker: string;
}

const DOC_SECTIONS: DocSection[] = [
  { id: "overview", title: "Overview", kicker: "01" },
  { id: "onboarding", title: "Onboarding & Accounts", kicker: "02" },
  { id: "features", title: "Features & Token Mentions", kicker: "03" },
  { id: "network", title: "Elysium 99901 & Launchpads", kicker: "04" },
  { id: "quotas", title: "Storage & Quotas", kicker: "05" },
  { id: "security", title: "Privacy, Caching & Security", kicker: "06" },
  { id: "support", title: "Troubleshooting & Support", kicker: "07" },
];

export function Docs(): React.ReactElement {
  const [activeId, setActiveId] = useState("overview");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );

    for (const s of DOC_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="docs-page">
      <header className="landing-header">
        <Link to="/" className="landing-brand-row">
          <ThreadsiumMark size={30} />
          <div>
            <span className="landing-brand-title">Threadsium Docs</span>
            <span className="landing-brand-tag">Elysium 99901 User Guide</span>
          </div>
        </Link>

        <div className="landing-nav-actions">
          <Link to="/app" className="btn btn-primary btn-sm">
            Back to Trench Feed
          </Link>
          <ThemeControl />
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="Documentation table of contents">
          <span className="toc-heading">Contents</span>
          <nav className="toc-list">
            {DOC_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`toc-link ${activeId === s.id ? "is-active" : ""}`}
                onClick={() => setActiveId(s.id)}
              >
                <span className="toc-num">{s.kicker}</span>
                <span>{s.title}</span>
              </a>
            ))}
          </nav>
        </aside>

        <main className="docs-content">
          <article id="overview" className="doc-chapter">
            <span className="doc-kicker">01 / OVERVIEW</span>
            <h1>What is Threadsium?</h1>
            <p>
              <strong>Threadsium</strong> is the dedicated Web3 social feed, token discussion room, and live on-chain swap chart terminal built for <strong>Elysium (chain ID 99901 · provisional, native currency HYPE)</strong>.
            </p>
            <div className="doc-callout">
              <strong>Provisional Network Notice:</strong> Elysium is currently indexed at chain ID <code>99901</code> (<code>0x1863d</code>) via Kinetiq RPC (<code>{ELYSIUM_CHAIN.rpcPrimary}</code>) and block explorer <a href={ELYSIUM_CHAIN.explorerUrl} target="_blank" rel="noopener noreferrer">elyscan.live</a>. Because Kinetiq's public documentation still marks final mainnet parameters as provisional, Threadsium labels all 99901 telemetry accordingly.
            </div>
          </article>

          <article id="onboarding" className="doc-chapter">
            <span className="doc-kicker">02 / ONBOARDING &amp; ACCOUNTS</span>
            <h2>Creating an Operator Handle &amp; Linking a Wallet</h2>
            <p>
              You can browse the entire timeline, token Hall of Fame, and live swap charts as a guest. To publish threads, rate tokens, comment in token timelines, or send direct messages:
            </p>
            <ol className="doc-list">
              <li>
                Visit <Link to="/auth">/auth</Link> and register a 3–20 character handle (letters, numbers, underscores) with a password.
              </li>
              <li>
                Choose one of the 6 original Elysium character avatars or upload a custom avatar in <Link to="/app/settings">Settings</Link>.
              </li>
              <li>
                <strong>Optional Wallet Link:</strong> In Settings, link your <code>0x</code> wallet address or click <strong>EIP-191 Sign &amp; Verify</strong> to cryptographically prove ownership. Verified wallets unlock on-chain holder badges on every token room:
                <ul>
                  <li><strong>🐋 Whale:</strong> Holds <code>≥ 1.0%</code> of total token supply.</li>
                  <li><strong>✓ Holder:</strong> Holds a positive token balance (<code>&gt; 0</code>).</li>
                  <li><strong>Spectator:</strong> Holds <code>0</code> balance of that token.</li>
                </ul>
              </li>
            </ol>
          </article>

          <article id="features" className="doc-chapter">
            <span className="doc-kicker">03 / FEATURES &amp; TOKEN MENTIONS</span>
            <h2>Threads, Rethreads, Quotes, and Auto-Linked Tokens</h2>
            <p>
              Every post or reply supports up to 500 characters and automatic entity parsing:
            </p>
            <ul className="doc-list">
              <li>
                <strong>Ticker Mentions (<code>$KNTQ</code>, <code>$BOXA</code>, <code>$KLEOS</code>):</strong> Automatically link to the token's dedicated room and chart page if known in the directory, or to Trench Search.
              </li>
              <li>
                <strong>Contract Addresses (<code>0x...</code>):</strong> Any 40-hex EVM contract address automatically resolves to <code>/app/token/:address</code>.
              </li>
              <li>
                <strong>Hashtags (<code>#elysium</code>) &amp; Handles (<code>@username</code>):</strong> Link directly to topic search and operator profiles.
              </li>
              <li>
                <strong>Pure Reposts &amp; Quote Threads:</strong> Click the Repost icon to rethread a post to your followers' timelines, or click <strong>Quote</strong> to attach commentary above the quoted card.
              </li>
            </ul>
          </article>

          <article id="network" className="doc-chapter">
            <span className="doc-kicker">04 / ELYSIUM 99901 &amp; LAUNCHPADS</span>
            <h2>Indexed DEX Venues &amp; Flagship Tokens</h2>
            <p>
              Unlike chains that rely on third-party chart iframes, Threadsium reads <code>PoolCreated</code>, <code>Initialize</code>, and <code>Swap</code> events directly from Elysium 99901 across <strong>{V3_VENUES.length} Uniswap V3 factories</strong> and <strong>{V4_MANAGERS.length} Uniswap V4 PoolManagers</strong>.
            </p>
            <div className="table-scroll">
              <table className="swaps-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Launchpad</th>
                    <th>Contract Address</th>
                  </tr>
                </thead>
                <tbody>
                  {SEEDED_TOKENS.map((t) => (
                    <tr key={t.address}>
                      <td className="font-semibold">${t.symbol}</td>
                      <td>{t.name}</td>
                      <td>{t.launchpad}</td>
                      <td className="font-mono">
                        <Link to={`/app/token/${t.address}`}>{t.address}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article id="quotas" className="doc-chapter">
            <span className="doc-kicker">05 / STORAGE &amp; QUOTAS</span>
            <h2>Media Limits &amp; Retention Policy</h2>
            <p>
              Threadsium runs on Cloudflare's zero-cost edge architecture with strict per-upload validation and automatic cleanup so the community timeline remains fast and sustainable:
            </p>
            <ul className="doc-list">
              <li>
                <strong>Post &amp; Banner Images:</strong> Up to <code>4 MB</code> per image (verified PNG, JPEG, WebP, or GIF magic bytes only).
              </li>
              <li>
                <strong>Custom Avatars:</strong> Up to <code>2 MB</code> per image.
              </li>
              <li>
                <strong>Notification Window:</strong> Notifications are retained for a rolling <code>12-hour</code> window and automatically pruned hourly.
              </li>
              <li>
                <strong>Write Rate Limits:</strong> Registration, login, post creation, and media uploads are rate-limited per IP and account to prevent spam.
              </li>
            </ul>
          </article>

          <article id="security" className="doc-chapter">
            <span className="doc-kicker">06 / PRIVACY, CACHING &amp; SECURITY</span>
            <h2>Session Isolation &amp; Cache Safety</h2>
            <p>
              Account sessions use <code>HttpOnly; SameSite=Lax</code> cookies paired with per-session <code>X-CSRF-Token</code> verification on all mutating requests. All authenticated and user-specific endpoints emit <code>Cache-Control: private, no-store, no-cache, must-revalidate</code> and <code>Vary: Cookie</code> so personalized data is never stored in shared edge caches.
            </p>
          </article>

          <article id="support" className="doc-chapter">
            <span className="doc-kicker">07 / TROUBLESHOOTING &amp; SUPPORT</span>
            <h2>Common Questions</h2>
            <ul className="doc-list">
              <li>
                <strong>Why does a token chart show "No recent Swap events"?</strong> The chart scans the most recent ~9,500 blocks on Elysium 99901 across all V3 and V4 pools. If a token has not traded in that window, the header still displays its pool reserve spot price and full comment timeline.
              </li>
              <li>
                <strong>How do I hide my Follower/Following lists?</strong> Open <Link to="/app/settings">Settings</Link> and uncheck <em>Allow other operators to view my Followers &amp; Following lists</em>.
              </li>
            </ul>
          </article>
        </main>
      </div>
    </div>
  );
}
