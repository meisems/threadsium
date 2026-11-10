import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { LaunchpadMark, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconLaunchpads, IconSearch, IconStar } from "../components/icons";
import { SentimentBar } from "../components/Sentiment";
import { fmtCompact } from "../lib/format";
import { useApp } from "../state";

type Sort = "talked" | "volume" | "depth" | "swaps" | "rated";
const SORTS: { id: Sort; label: string }[] = [
  { id: "talked", label: "Most discussed" },
  { id: "volume", label: "24h volume" },
  { id: "depth", label: "Deepest pools" },
  { id: "swaps", label: "Most swaps" },
  { id: "rated", label: "Best rated" },
];

const LAUNCHPAD_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "platform-tokens", label: "Launchpad tokens" },
  { id: "montra", label: "Montra" },
  { id: "kleos", label: "Kleos" },
  { id: "boxa", label: "BOXA" },
  { id: "elyxa", label: "ELYXA" },
  { id: "obol", label: "Obol" },
  { id: "eleos", label: "Eleos" },
  { id: "volta", label: "Volta" },
  { id: "elyspump", label: "ElysPump" },
  { id: "ronspad", label: "Ronspad" },
  { id: "stockium", label: "Stockium" },
];

export function Rooms(): React.ReactElement {
  const { tokens, tokensLive } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("talked");
  const [lpFilter, setLpFilter] = useState<string>(() => {
    const param = new URLSearchParams(location.search).get("launchpad");
    return param ? param.toLowerCase() : "all";
  });

  useEffect(() => {
    const param = new URLSearchParams(location.search).get("launchpad");
    if (param) setLpFilter(param.toLowerCase());
  }, [location.search]);

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q.trim());
  const rows = useMemo(() => {
    const needle = q.trim().replace(/^\$/, "").toLowerCase();
    let list = needle
      ? tokens.filter(
          (t) =>
            t.symbol.toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle) ||
            t.address.toLowerCase() === needle ||
            t.launchpad.toLowerCase().includes(needle)
        )
      : tokens;

    if (lpFilter === "platform-tokens") {
      list = list.filter((t) => t.isLaunchpadToken);
    } else if (lpFilter !== "all") {
      list = list.filter(
        (t) =>
          (t.launchpadId && t.launchpadId.toLowerCase() === lpFilter) ||
          t.launchpad.toLowerCase() === lpFilter ||
          t.sources?.includes(lpFilter)
      );
    }

    const by: Record<
      Sort,
      (a: (typeof tokens)[number], b: (typeof tokens)[number]) => number
    > = {
      talked: (a, b) =>
        b.commentCount - a.commentCount ||
        Number(b.featured) - Number(a.featured) ||
        (b.volume24h ?? 0) - (a.volume24h ?? 0) ||
        b.hypeDepth - a.hypeDepth,
      volume: (a, b) =>
        (b.volume24h ?? 0) - (a.volume24h ?? 0) || b.hypeDepth - a.hypeDepth,
      depth: (a, b) =>
        b.hypeDepth - a.hypeDepth || (b.volume24h ?? 0) - (a.volume24h ?? 0),
      swaps: (a, b) =>
        b.recentSwaps - a.recentSwaps || b.hypeDepth - a.hypeDepth,
      rated: (a, b) =>
        b.avgRating - a.avgRating || b.ratingCount - a.ratingCount,
    };
    return [...list].sort(by[sort]).slice(0, 100);
  }, [tokens, q, sort, lpFilter]);

  return (
    <>
      <header className="page-head page-head-split">
        <div>
          <h1>Rooms</h1>
          <p>
            Every Elysium token has a synced room: its chart from launchpad &amp; on-chain swaps, a bullish or bearish vote, and the posts about it.
          </p>
        </div>
        <Link to="/app/launchpads" className="btn btn-ghost btn-small">
          <IconLaunchpads size={16} /> Launchpad Rankings
        </Link>
      </header>

      <form
        className="rooms-filter"
        onSubmit={(e) => {
          e.preventDefault();
          if (isAddress) navigate(`/app/token/${q.trim().toLowerCase()}`);
        }}
      >
        <label className="search-box search-box-wide">
          <IconSearch size={18} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by ticker, name, launchpad, or paste a 0x contract address"
            aria-label="Filter rooms"
            maxLength={64}
          />
        </label>
        <label className="select">
          <span className="sr-only">Sort rooms</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div
        className="lp-filter-pills"
        role="group"
        aria-label="Filter rooms by launchpad"
      >
        {LAUNCHPAD_FILTERS.map((f) => {
          const active = lpFilter === f.id;
          const isLp = f.id !== "all" && f.id !== "platform-tokens";
          return (
            <button
              key={f.id}
              type="button"
              className={`lp-filter-pill${active ? " is-on" : ""}`}
              aria-pressed={active}
              onClick={() => setLpFilter(f.id)}
            >
              {isLp ? (
                <LaunchpadMark id={f.id} name={f.label} size={18} />
              ) : null}
              <span>{f.label}</span>
            </button>
          );
        })}
      </div>

      {isAddress && !rows.length ? (
        <div className="notice">
          <p>
            That contract is not in the directory yet, but it still has a room.
          </p>
          <Link
            className="btn btn-primary"
            to={`/app/token/${q.trim().toLowerCase()}`}
          >
            Open the room for {q.trim().slice(0, 8)}…
          </Link>
        </div>
      ) : null}

      {!tokensLive ? (
        <Loom
          compact
          label="Reading pools & launchpads from the chain"
          detail="Showing the verified list until the scan finishes"
        />
      ) : null}

      <ul className="room-list">
        {rows.map((t) => (
          <li key={t.address}>
            <Link to={`/app/token/${t.address}`} className="room-row">
              <TokenMark
                address={t.address}
                symbol={t.symbol}
                size={44}
                imageUrl={t.imageUrl}
              />
              <span className="room-row-main">
                <span className="room-row-title">
                  <strong>${t.symbol}</strong>
                  <span>{t.name}</span>
                  {t.isLaunchpadToken ? (
                    <span className="tag tag-verified">Launchpad token</span>
                  ) : t.featured ? (
                    <span className="tag tag-verified">
                      Listed by its launchpad
                    </span>
                  ) : null}
                </span>
                <span className="room-row-meta">
                  <span>{t.venueBadge || t.launchpad}</span>
                  {t.volume24h && t.volume24h > 0 ? (
                    <span>{fmtCompact(t.volume24h, 1)} HYPE 24h vol</span>
                  ) : null}
                  <span>
                    {t.hypeDepth > 0
                      ? `${fmtCompact(t.hypeDepth, 1)} HYPE in pools`
                      : "no pool depth found"}
                  </span>
                  {t.holders && t.holders > 0 ? (
                    <span>{t.holders} holders</span>
                  ) : t.recentSwaps > 0 ? (
                    <span>{t.recentSwaps} recent swaps</span>
                  ) : null}
                </span>
              </span>
              <span className="room-row-side">
                <SentimentBar
                  bullish={t.bullishCount}
                  bearish={t.bearishCount}
                />
                <span className="room-row-stats">
                  <span>
                    {t.commentCount} {t.commentCount === 1 ? "post" : "posts"}
                  </span>
                  {t.ratingCount > 0 ? (
                    <span className="rating-inline">
                      <IconStar size={14} filled /> {t.avgRating.toFixed(1)} (
                      {t.ratingCount})
                    </span>
                  ) : null}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!rows.length && !isAddress ? (
        <div className="empty">
          <p>
            <strong>
              No room matches{q ? ` “${q}”` : " the selected launchpad filter"}.
            </strong>
          </p>
          <p>
            Paste the token's 0x contract address to open its room directly, or{" "}
            <button
              type="button"
              className="link-inline"
              onClick={() => {
                setQ("");
                setLpFilter("all");
              }}
            >
              clear filters
            </button>
            .
          </p>
        </div>
      ) : null}
    </>
  );
}
