import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { CHAIN } from "../config/chain";
import { api, type Person } from "../lib/api";
import { fmtCompact } from "../lib/format";
import { useApp } from "../state";
import { Avatar, TokenMark } from "./Avatar";
import { Mark, Wordmark } from "./brand";
import { ComposerDialog } from "./Composer";
import {
  IconBell,
  IconBookmark,
  IconCompose,
  IconDocs,
  IconHome,
  IconLaunchpads,
  IconLogout,
  IconMail,
  IconRooms,
  IconSearch,
  IconSettings,
  IconSwap,
  IconUser,
  IconWake,
} from "./icons";
import { useAuthGuard, useDismiss } from "./PostCard";
import { ThemeControl } from "./ThemeControl";

function Badge({ n }: { n: number }): React.ReactElement | null {
  if (n <= 0) return null;
  return (
    <span className="badge-count" aria-label={`${n} unread`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function SearchBox(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (location.pathname === "/app/search") setQ(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.pathname, location.search]);
  return (
    <form
      className="search-box"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        // A pasted contract address goes straight to that token's room.
        if (/^0x[a-fA-F0-9]{40}$/.test(v)) navigate(`/app/token/${v.toLowerCase()}`);
        else navigate(`/app/search${v ? `?q=${encodeURIComponent(v)}` : ""}`);
      }}
    >
      <IconSearch size={18} />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, posts, $tokens or paste 0x…"
        aria-label="Search Threadsium"
        maxLength={64}
        enterKeyHint="search"
      />
    </form>
  );
}

function AccountMenu(): React.ReactElement {
  const { user, signOut, toast } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, open, () => setOpen(false));
  if (!user) {
    return (
      <Link className="btn btn-primary btn-small" to="/auth">
        Sign in
      </Link>
    );
  }
  return (
    <div className="account" ref={ref}>
      <button type="button" className="account-btn" aria-haspopup="true" aria-expanded={open} aria-label="Your account" onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} size={34} />
      </button>
      {open ? (
        <div className="menu menu-right menu-account" role="menu">
          <div className="menu-id">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <Link role="menuitem" to={`/app/u/${user.username}`} onClick={() => setOpen(false)}>
            <IconUser size={17} /> Profile
          </Link>
          <Link role="menuitem" to="/app/saved" onClick={() => setOpen(false)}>
            <IconBookmark size={17} /> Saved
          </Link>
          <Link role="menuitem" to="/app/swap" onClick={() => setOpen(false)}>
            <IconSwap size={17} /> Swap
          </Link>
          <Link role="menuitem" to="/app/whales" onClick={() => setOpen(false)}>
            <IconWake size={17} /> Whale watch
          </Link>
          <Link role="menuitem" to="/app/settings" onClick={() => setOpen(false)}>
            <IconSettings size={17} /> Settings
          </Link>
          <Link role="menuitem" to="/docs" onClick={() => setOpen(false)}>
            <IconDocs size={17} /> Help and docs
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await signOut();
              toast("Signed out");
              navigate("/app");
            }}
          >
            <IconLogout size={17} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChainPill(): React.ReactElement {
  const { hypeUsd, block } = useApp();
  return (
    <a className="chain-pill" href={CHAIN.explorer} target="_blank" rel="noopener noreferrer" title="Elysium, chain 99901. Opens the community block explorer.">
      <span className={`chain-dot${block ? " is-live" : ""}`} aria-hidden="true" />
      <span>Elysium</span>
      <span className="chain-num">{block ? `#${block.toLocaleString("en-US")}` : "connecting"}</span>
      <span className="chain-sep" aria-hidden="true" />
      <span>HYPE</span>
      <span className="chain-num">{hypeUsd ? `$${hypeUsd.toFixed(2)}` : "price unavailable"}</span>
    </a>
  );
}

function LeftNav(): React.ReactElement {
  const { user, counts, tokens, compose } = useApp();
  const guard = useAuthGuard();
  const rooms = [...tokens].sort((a, b) => Number(b.featured) - Number(a.featured) || b.commentCount - a.commentCount || b.hypeDepth - a.hypeDepth).slice(0, 5);
  const item = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " is-active" : ""}`;
  return (
    <nav className="left-nav" aria-label="Main">
      <NavLink to="/app" end className={item}>
        {({ isActive }) => (
          <>
            <IconHome filled={isActive} /> <span>Home</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/rooms" className={item}>
        {({ isActive }) => (
          <>
            <IconRooms filled={isActive} /> <span>Rooms</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/launchpads" className={item}>
        {({ isActive }) => (
          <>
            <IconLaunchpads filled={isActive} /> <span>Launchpads</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/swap" className={item}>
        <IconSwap /> <span>Swap</span>
      </NavLink>
      <NavLink to="/app/whales" className={item}>
        {({ isActive }) => (
          <>
            <IconWake filled={isActive} /> <span>Whale watch</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/notifications" className={item}>
        {({ isActive }) => (
          <>
            <span className="nav-icon">
              <IconBell filled={isActive} />
              <Badge n={counts.notifications} />
            </span>
            <span>Notifications</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/messages" className={item}>
        {({ isActive }) => (
          <>
            <span className="nav-icon">
              <IconMail filled={isActive} />
              <Badge n={counts.messages} />
            </span>
            <span>Messages</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/saved" className={item}>
        {({ isActive }) => (
          <>
            <IconBookmark filled={isActive} /> <span>Saved</span>
          </>
        )}
      </NavLink>
      <NavLink to={user ? `/app/u/${user.username}` : "/auth"} className={item}>
        {({ isActive }) => (
          <>
            <IconUser filled={isActive && !!user} /> <span>Profile</span>
          </>
        )}
      </NavLink>
      <NavLink to="/app/settings" className={item}>
        <IconSettings /> <span>Settings</span>
      </NavLink>

      <button type="button" className="btn btn-primary nav-post" onClick={() => guard("post") && compose()}>
        <IconCompose size={19} /> <span>Post</span>
      </button>

      <div className="nav-rooms">
        <h2 className="rail-title">Rooms</h2>
        {rooms.map((t) => (
          <NavLink key={t.address} to={`/app/token/${t.address}`} className={({ isActive }) => `nav-room${isActive ? " is-active" : ""}`} title={`${t.name} room`}>
            <TokenMark address={t.address} symbol={t.symbol} size={26} imageUrl={t.imageUrl} />
            <span>${t.symbol}</span>
          </NavLink>
        ))}
        <Link to="/app/rooms" className="nav-room nav-room-all">
          All rooms
        </Link>
      </div>
    </nav>
  );
}

export function FollowButton({ person, onChange, small = true }: { person: { username: string }; onChange?: (following: boolean, followers: number) => void; small?: boolean }): React.ReactElement {
  const { toast } = useApp();
  const guard = useAuthGuard();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${following ? "btn-ghost" : "btn-ink"}${small ? " btn-small" : ""}`}
      disabled={busy}
      aria-pressed={following}
      onClick={async () => {
        if (!guard("follow people")) return;
        setBusy(true);
        try {
          const r = await api.follow(person.username);
          setFollowing(r.following);
          onChange?.(r.following, r.followers);
        } catch (e) {
          toast((e as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

function RightRail(): React.ReactElement {
  const { tokens, tokensLive, user } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  const [tags, setTags] = useState<{ tag: string; posts: number }[]>([]);
  useEffect(() => {
    api
      .discover()
      .then((r) => {
        setPeople(r.people);
        setTags(r.tags);
      })
      .catch(() => undefined);
  }, [user?.id]);

  const active = [...tokens].sort((a, b) => b.recentSwaps - a.recentSwaps || b.hypeDepth - a.hypeDepth).slice(0, 6);
  return (
    <aside className="right-rail" aria-label="Elysium activity and suggestions">
      <section className="rail-card">
        <h2 className="rail-title">Active on Elysium</h2>
        {tokensLive ? (
          <ol className="rail-list">
            {active.map((t) => (
              <li key={t.address}>
                <Link to={`/app/token/${t.address}`} className="rail-row">
                  <TokenMark address={t.address} symbol={t.symbol} size={32} imageUrl={t.imageUrl} />
                  <span className="rail-row-main">
                    <strong>${t.symbol}</strong>
                    <span>{t.name}</span>
                  </span>
                  <span className="rail-row-side">
                    <strong>{t.hypeDepth > 0 ? `${fmtCompact(t.hypeDepth, 1)} HYPE` : "no pool depth"}</strong>
                    <span>{t.recentSwaps > 0 ? `${t.recentSwaps} recent swaps` : t.commentCount > 0 ? `${t.commentCount} posts` : "quiet"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rail-note">Reading pools from the chain…</p>
        )}
        <p className="rail-note">Pool depth and swap counts are read from Elysium's V3 and V4 pools, refreshed every few minutes.</p>
      </section>

      {people.length ? (
        <section className="rail-card">
          <h2 className="rail-title">People to follow</h2>
          <ul className="rail-list">
            {people.map((p) => (
              <li key={p.id} className="rail-row">
                <Link to={`/app/u/${p.username}`} aria-hidden="true" tabIndex={-1}>
                  <Avatar user={p} size={34} />
                </Link>
                <Link to={`/app/u/${p.username}`} className="rail-row-main">
                  <strong>{p.displayName}</strong>
                  <span>@{p.username}</span>
                </Link>
                <FollowButton person={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tags.length ? (
        <section className="rail-card">
          <h2 className="rail-title">Tags this week</h2>
          <ul className="rail-tags">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link to={`/app/search?q=${encodeURIComponent(t.tag)}`}>
                  {t.tag} <span>{t.posts}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="rail-foot">
        <Link to="/docs">Docs</Link>
        <Link to="/docs#privacy">Privacy</Link>
        <Link to="/docs#limits">Limits</Link>
        <a href={CHAIN.explorer} target="_blank" rel="noopener noreferrer">
          Explorer
        </a>
        <p>Threadsium is a community project and is not run by Kinetiq. Nothing here is financial advice.</p>
      </footer>
    </aside>
  );
}

function TabBar(): React.ReactElement {
  const { user, counts, compose } = useApp();
  const guard = useAuthGuard();
  const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? " is-active" : ""}`;
  return (
    <nav className="tab-bar" aria-label="Main">
      <NavLink to="/app" end className={tab} aria-label="Home">
        {({ isActive }) => <IconHome size={25} filled={isActive} />}
      </NavLink>
      <NavLink to="/app/rooms" className={tab} aria-label="Rooms">
        {({ isActive }) => <IconRooms size={25} filled={isActive} />}
      </NavLink>
      <button type="button" className="tab tab-compose" aria-label="New post" onClick={() => guard("post") && compose()}>
        <IconCompose size={24} />
      </button>
      <NavLink to="/app/notifications" className={tab} aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ""}`}>
        {({ isActive }) => (
          <span className="nav-icon">
            <IconBell size={25} filled={isActive} />
            <Badge n={counts.notifications} />
          </span>
        )}
      </NavLink>
      <NavLink to={user ? `/app/u/${user.username}` : "/auth"} className={tab} aria-label="Profile">
        {({ isActive }) => <IconUser size={25} filled={isActive && !!user} />}
      </NavLink>
    </nav>
  );
}

export function TopBar({ app = true }: { app?: boolean }): React.ReactElement {
  const { counts, user } = useApp();
  return (
    <header className="top-bar">
      <div className="top-bar-inner">
        <Link to={app ? "/app" : "/"} className="top-brand" aria-label="Threadsium home">
          <span className="top-brand-full">
            <Wordmark size={26} />
          </span>
          <span className="top-brand-mark">
            <Mark size={28} />
          </span>
        </Link>
        {app ? <SearchBox /> : <span className="top-spacer" />}
        <div className="top-actions">
          <ChainPill />
          {app ? (
            <>
              <Link to="/app/search" className="icon-btn top-only-small" aria-label="Search">
                <IconSearch size={21} />
              </Link>
              <Link to="/app/swap" className="icon-btn top-only-small" aria-label="Swap">
                <IconSwap size={21} />
              </Link>
              {user ? (
                <Link to="/app/messages" className="icon-btn top-only-small nav-icon" aria-label={`Messages${counts.messages ? `, ${counts.messages} unread` : ""}`}>
                  <IconMail size={21} />
                  <Badge n={counts.messages} />
                </Link>
              ) : null}
            </>
          ) : (
            <Link to="/docs" className="top-link">
              Docs
            </Link>
          )}
          <ThemeControl compact />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

export function Shell(): React.ReactElement {
  const location = useLocation();
  const wide = location.pathname.startsWith("/app/messages");
  const main = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // New page: start at the top, unless the link points at the reply box.
    if (!location.hash) window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar />
      <div className={`app-grid${wide ? " app-grid-wide" : ""}`}>
        <LeftNav />
        <main id="main" className="center" ref={main} tabIndex={-1}>
          <Outlet />
        </main>
        {wide ? null : <RightRail />}
      </div>
      <TabBar />
      <ComposerDialog />
    </div>
  );
}
