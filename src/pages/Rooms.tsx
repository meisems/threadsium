import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconSearch, IconStar } from "../components/icons";
import { SentimentBar } from "../components/Sentiment";
import { fmtCompact } from "../lib/format";
import { useApp } from "../state";

type Sort = "talked" | "depth" | "swaps" | "rated";
const SORTS: { id: Sort; label: string }[] = [
  { id: "talked", label: "Most discussed" },
  { id: "depth", label: "Deepest pools" },
  { id: "swaps", label: "Most swaps" },
  { id: "rated", label: "Best rated" },
];

export function Rooms(): React.ReactElement {
  const { tokens, tokensLive } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("talked");

  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q.trim());
  const rows = useMemo(() => {
    const needle = q.trim().replace(/^\$/, "").toLowerCase();
    const list = needle
      ? tokens.filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) || t.address === needle)
      : tokens;
    const by: Record<Sort, (a: (typeof tokens)[number], b: (typeof tokens)[number]) => number> = {
      talked: (a, b) => b.commentCount - a.commentCount || Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth,
      depth: (a, b) => b.hypeDepth - a.hypeDepth,
      swaps: (a, b) => b.recentSwaps - a.recentSwaps || b.hypeDepth - a.hypeDepth,
      rated: (a, b) => b.avgRating - a.avgRating || b.ratingCount - a.ratingCount,
    };
    return [...list].sort(by[sort]).slice(0, 80);
  }, [tokens, q, sort]);

  return (
    <>
      <header className="page-head">
        <h1>Rooms</h1>
        <p>Every Elysium token has a room: its chart from on-chain swaps, a bullish or bearish vote, and the posts about it.</p>
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ticker or name, or paste a 0x contract address" aria-label="Filter rooms" maxLength={64} />
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

      {isAddress && !rows.length ? (
        <div className="notice">
          <p>That contract is not in the directory yet, but it still has a room.</p>
          <Link className="btn btn-primary" to={`/app/token/${q.trim().toLowerCase()}`}>
            Open the room for {q.trim().slice(0, 8)}…
          </Link>
        </div>
      ) : null}

      {!tokensLive ? <Loom compact label="Reading pools from the chain" detail="Showing the verified list until the scan finishes" /> : null}

      <ul className="room-list">
        {rows.map((t) => (
          <li key={t.address}>
            <Link to={`/app/token/${t.address}`} className="room-row">
              <TokenMark address={t.address} symbol={t.symbol} size={44} />
              <span className="room-row-main">
                <span className="room-row-title">
                  <strong>${t.symbol}</strong>
                  <span>{t.name}</span>
                  {t.featured ? <span className="tag tag-verified">Listed by its launchpad</span> : null}
                </span>
                <span className="room-row-meta">
                  <span>{t.venueBadge || t.launchpad}</span>
                  <span>{t.hypeDepth > 0 ? `${fmtCompact(t.hypeDepth, 1)} HYPE in pools` : "no pool depth found"}</span>
                  {t.recentSwaps > 0 ? <span>{t.recentSwaps} recent swaps</span> : null}
                </span>
              </span>
              <span className="room-row-side">
                <SentimentBar bullish={t.bullishCount} bearish={t.bearishCount} />
                <span className="room-row-stats">
                  <span>
                    {t.commentCount} {t.commentCount === 1 ? "post" : "posts"}
                  </span>
                  {t.ratingCount > 0 ? (
                    <span className="rating-inline">
                      <IconStar size={14} filled /> {t.avgRating.toFixed(1)} ({t.ratingCount})
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
            <strong>No room matches “{q}”.</strong>
          </p>
          <p>Paste the token's 0x contract address to open its room directly.</p>
        </div>
      ) : null}
    </>
  );
}
