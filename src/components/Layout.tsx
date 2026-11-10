import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { AuthUser, DirectoryToken, api } from "../lib/api";
import { TokenMark, UserAvatar } from "../lib/avatars";
import { ThreadsiumMark } from "./brand";
import { ThemeControl } from "./ThemeControl";
import { fetchLatestBlock } from "../lib/rpc";
import { fmtCompact, fmtPrice } from "../lib/format";

export function Layout({
  user,
  directory,
  hypeUsd,
  unreadNotifications,
  onLogout,
  children,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
  hypeUsd: number;
  unreadNotifications: number;
  onLogout: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [quickQuery, setQuickQuery] = useState("");
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      fetchLatestBlock()
        .then((b) => {
          if (alive && b.blockNumber > 0) setBlockNumber(b.blockNumber);
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 12000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    if (!q) return;
    if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
      navigate(`/app/token/${q.toLowerCase()}`);
    } else {
      navigate(`/app/search?q=${encodeURIComponent(q)}`);
    }
  };

  const topTokens = directory.slice(0, 7);

  return (
    <div className="app-shell">
      {/* Top status strip */}
      <header className="top-telemetry-bar">
        <div className="telemetry-left">
          <Link to="/" className="telemetry-brand">
            <ThreadsiumMark size={24} />
            <span className="telemetry-brand-name">Threadsium</span>
          </Link>
          <span className="network-pill" title="Chain ID 99901 (0x1863d) — provisional Elysium profile">
            <span className="pulse-dot" />
            Elysium 99901 · provisional
          </span>
          {blockNumber && (
            <a
              href="https://elyscan.live"
              target="_blank"
              rel="noopener noreferrer"
              className="telemetry-stat hide-sm"
            >
              Block #{blockNumber.toLocaleString()}
            </a>
          )}
          <span className="telemetry-stat hide-xs">
            HYPE <strong>${hypeUsd.toFixed(2)}</strong>
          </span>
        </div>

        <div className="telemetry-right">
          <Link to="/docs" className="telemetry-doc-link hide-xs">
            Docs
          </Link>
          <ThemeControl />
          <button
            type="button"
            className="mobile-menu-trigger show-mobile-only"
            onClick={() => setMobileDrawerOpen((v) => !v)}
            aria-label="Toggle navigation drawer"
            aria-expanded={mobileDrawerOpen}
          >
            ☰
          </button>
        </div>
      </header>

      <div className="shell-grid">
        {/* Left Navigation Rail */}
        <aside
          className={`left-rail ${mobileDrawerOpen ? "is-open" : ""}`}
          aria-label="Primary navigation"
        >
          <nav className="nav-stack">
            <NavLink to="/app" end className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="nav-label">Trench Feed</span>
            </NavLink>

            <NavLink to="/app/search" className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.9" />
                <path d="M20 20L16.5 16.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
              <span className="nav-label">Explore &amp; Tokens</span>
            </NavLink>

            <NavLink to="/app/notifications" className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="nav-label">Notifications</span>
              {unreadNotifications > 0 && (
                <span className="nav-badge">{unreadNotifications}</span>
              )}
            </NavLink>

            <NavLink to="/app/messages" className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                />
                <path d="M22 6l-10 7L2 6" stroke="currentColor" strokeWidth="1.9" />
              </svg>
              <span className="nav-label">Direct Messages</span>
            </NavLink>

            {user && (
              <NavLink to={`/app/u/${user.username}`} className="nav-item">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.9" />
                  <path
                    d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="nav-label">Profile</span>
              </NavLink>
            )}

            <NavLink to="/app/settings" className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.9" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
              </svg>
              <span className="nav-label">Settings</span>
            </NavLink>

            <NavLink to="/docs" className="nav-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                />
              </svg>
              <span className="nav-label">Documentation</span>
            </NavLink>
          </nav>

          <div className="rail-user-box">
            {user ? (
              <div className="rail-user-card">
                <Link to={`/app/u/${user.username}`} className="rail-user-info">
                  <UserAvatar
                    avatarId={user.avatarId}
                    avatarUrl={user.avatarUrl}
                    username={user.username}
                    size={38}
                  />
                  <div className="rail-user-text">
                    <span className="rail-user-name">{user.displayName}</span>
                    <span className="rail-user-handle">@{user.username}</span>
                  </div>
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={onLogout}
                  title="Sign out"
                >
                  Out
                </button>
              </div>
            ) : (
              <Link to="/auth" className="btn btn-primary btn-block">
                Sign In / Join
              </Link>
            )}
          </div>
        </aside>

        {/* Center Primary Feed Column */}
        <main className="center-feed-col" id="main-content">
          {children}
        </main>

        {/* Right Context / Token Trench Column */}
        <aside className="right-context-col" aria-label="Elysium 99901 Token Radar">
          <form className="quick-search-form" onSubmit={handleQuickSearch}>
            <input
              type="search"
              className="quick-search-input"
              placeholder="Search $TICKER, 0x address, @user…"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              aria-label="Search tokens, addresses, or users"
            />
          </form>

          <section className="side-panel">
            <div className="side-panel-header">
              <h2 className="side-panel-title">99901 Hall of Fame</h2>
              <Link to="/app/search" className="side-panel-link">
                All ({directory.length})
              </Link>
            </div>
            <p className="side-panel-sub">
              Live V3 &amp; V4 WHYPE pools + verified launchpad tokens
            </p>

            <div className="token-radar-list">
              {topTokens.map((t) => (
                <Link
                  key={t.address}
                  to={`/app/token/${t.address}`}
                  className="token-radar-row"
                >
                  <TokenMark address={t.address} symbol={t.symbol} size={34} />
                  <div className="token-radar-main">
                    <div className="token-radar-top">
                      <span className="token-radar-sym">${t.symbol}</span>
                      <span className="badge badge-subtle">{t.launchpad}</span>
                    </div>
                    <div className="token-radar-bottom">
                      <span>
                        {t.priceHype
                          ? `${fmtPrice(t.priceHype)} HYPE`
                          : t.name}
                      </span>
                      <span className="token-radar-liq">
                        {t.reserveWhype > 0
                          ? `${fmtCompact(t.reserveWhype, 1)} WHYPE`
                          : "Seeded"}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="side-panel">
            <h2 className="side-panel-title">Elysium Ecosystem</h2>
            <div className="eco-links-grid">
              <a
                href="https://elyscan.live"
                target="_blank"
                rel="noopener noreferrer"
                className="eco-pill-link"
              >
                Elyscan Explorer ↗
              </a>
              <a
                href="https://boxa.club"
                target="_blank"
                rel="noopener noreferrer"
                className="eco-pill-link"
              >
                BOXA Launchpad ↗
              </a>
              <a
                href="https://kleos.financial"
                target="_blank"
                rel="noopener noreferrer"
                className="eco-pill-link"
              >
                Kleos Protocol ↗
              </a>
              <a
                href="https://elyxa.indie.fun"
                target="_blank"
                rel="noopener noreferrer"
                className="eco-pill-link"
              >
                ELYXA Fun ↗
              </a>
            </div>
          </section>
        </aside>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav show-mobile-only" aria-label="Mobile navigation">
        <NavLink to="/app" end className="mob-nav-link">
          <span>Feed</span>
        </NavLink>
        <NavLink to="/app/search" className="mob-nav-link">
          <span>Tokens</span>
        </NavLink>
        <NavLink to="/app/notifications" className="mob-nav-link">
          <span>Alerts{unreadNotifications > 0 ? ` (${unreadNotifications})` : ""}</span>
        </NavLink>
        <NavLink to="/app/messages" className="mob-nav-link">
          <span>DMs</span>
        </NavLink>
        <NavLink to={user ? `/app/u/${user.username}` : "/auth"} className="mob-nav-link">
          <span>{user ? "Profile" : "Sign In"}</span>
        </NavLink>
      </nav>
    </div>
  );
}
