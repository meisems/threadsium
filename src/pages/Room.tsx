import React, { Suspense, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { ComposerBox } from "../components/Composer";
import { Feed } from "../components/Feed";
import { IconBack, IconCopy, IconDown, IconExternal, IconStar, IconUp } from "../components/icons";
import { useAuthGuard } from "../components/PostCard";
import { explorerToken } from "../config/chain";
import { api, type RoomStats } from "../lib/api";
import { fmtCompact, shortAddr } from "../lib/format";
import { useApp } from "../state";
import { SentimentBar } from "../components/Sentiment";

// The charting library is the largest dependency; it loads only when a room is opened.
const TokenChart = React.lazy(() => import("../components/TokenChart").then((m) => ({ default: m.TokenChart })));

interface Meta {
  symbol: string;
  name: string;
  decimals: number;
  description: string;
  launchpad: string;
  launchpadUrl: string;
  venueBadge: string;
  featured: boolean;
  onChain: boolean;
}

export function Room(): React.ReactElement {
  const { address: raw = "" } = useParams();
  const address = raw.toLowerCase();
  const valid = /^0x[a-f0-9]{40}$/.test(address);
  const { tokenByAddress, hypeUsd, toast, user } = useApp();
  const guard = useAuthGuard();
  const known = tokenByAddress(address);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaState, setMetaState] = useState<"loading" | "ready" | "error">("loading");
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setMeta(null);
    setMetaState("loading");
    setStats(null);
    api
      .tokenMeta(address)
      .then((m) => {
        if (!live) return;
        setMeta({ ...m, onChain: !m.rpcWarning });
        setMetaState("ready");
      })
      .catch(() => live && setMetaState("error"));
    api
      .room(address)
      .then((r) => live && setStats(r.room))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address, valid, user?.id]);

  if (!valid) {
    return (
      <div className="empty">
        <p>
          <strong>That is not a token contract address.</strong>
        </p>
        <p>Room links end in a 0x address with 40 hex characters.</p>
        <Link className="btn btn-primary" to="/app/rooms">
          Browse rooms
        </Link>
      </div>
    );
  }

  const symbol = meta?.symbol ?? known?.symbol ?? shortAddr(address);
  const name = meta?.name ?? known?.name ?? "Token";
  const description = known?.description || meta?.description || "";
  const launchpad = known?.launchpad ?? meta?.launchpad;
  const launchpadUrl = known?.launchpadUrl ?? meta?.launchpadUrl;

  const vote = async (v: { rating?: number | null; sentiment?: "bullish" | "bearish" | null }) => {
    if (!guard("vote in rooms") || voting) return;
    setVoting(true);
    try {
      const r = await api.vote(address, v);
      setStats(r.room);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setVoting(false);
    }
  };

  return (
    <>
      <div className="back-row">
        <Link to="/app/rooms" className="back-link">
          <IconBack size={18} /> Rooms
        </Link>
      </div>

      <header className="room-head">
        <TokenMark address={address} symbol={symbol} size={64} />
        <div className="room-head-main">
          <h1>
            ${symbol} <span>{name}</span>
          </h1>
          <div className="room-head-meta">
            <button
              type="button"
              className="chip chip-button mono"
              title="Copy the contract address"
              onClick={() =>
                navigator.clipboard
                  .writeText(address)
                  .then(() => toast("Contract address copied"))
                  .catch(() => toast("Copy is blocked in this browser", "error"))
              }
            >
              {shortAddr(address, 8, 6)} <IconCopy size={14} />
            </button>
            {known?.featured ? <span className="tag tag-verified">Listed by its launchpad</span> : null}
            {metaState === "ready" && meta && !meta.onChain ? <span className="tag tag-warn">Could not confirm on chain</span> : null}
            {metaState === "error" ? <span className="tag tag-warn">Token details unavailable</span> : null}
          </div>
          {description ? <p className="room-head-desc">{description}</p> : null}
          <div className="room-head-links">
            <a href={explorerToken(address)} target="_blank" rel="noopener noreferrer">
              Explorer <IconExternal size={14} />
            </a>
            {launchpadUrl && launchpad ? (
              <a href={launchpadUrl} target="_blank" rel="noopener noreferrer">
                {launchpad} <IconExternal size={14} />
              </a>
            ) : null}
            {known && known.hypeDepth > 0 ? <span>{fmtCompact(known.hypeDepth, 1)} HYPE in pools</span> : null}
          </div>
        </div>
      </header>

      <section className="room-vote" aria-label="Room vote">
        <div className="room-vote-row">
          <div className="vote-buttons" role="group" aria-label="Your view on this token">
            <button
              type="button"
              className={`vote vote-bull${stats?.mySentiment === "bullish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bullish"}
              disabled={voting}
              onClick={() => vote({ sentiment: stats?.mySentiment === "bullish" ? null : "bullish" })}
            >
              <IconUp size={18} /> Bullish <span>{stats?.bullish ?? 0}</span>
            </button>
            <button
              type="button"
              className={`vote vote-bear${stats?.mySentiment === "bearish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bearish"}
              disabled={voting}
              onClick={() => vote({ sentiment: stats?.mySentiment === "bearish" ? null : "bearish" })}
            >
              <IconDown size={18} /> Bearish <span>{stats?.bearish ?? 0}</span>
            </button>
          </div>
          <SentimentBar bullish={stats?.bullish ?? 0} bearish={stats?.bearish ?? 0} />
        </div>
        <div className="room-vote-row">
          <div className="stars" role="group" aria-label="Rate this token from 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star${(stats?.myRating ?? 0) >= n ? " is-on" : ""}`}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}${stats?.myRating === n ? ", your rating. Press to clear" : ""}`}
                aria-pressed={stats?.myRating === n}
                disabled={voting}
                onClick={() => vote({ rating: stats?.myRating === n ? null : n })}
              >
                <IconStar size={22} filled={(stats?.myRating ?? 0) >= n} />
              </button>
            ))}
          </div>
          <span className="room-vote-note">
            {stats && stats.ratingCount > 0
              ? `${stats.avgRating.toFixed(1)} average from ${stats.ratingCount} ${stats.ratingCount === 1 ? "rating" : "ratings"}`
              : "No ratings yet"}
            {stats?.myRating ? `, yours is ${stats.myRating}` : ""}
          </span>
        </div>
        <p className="room-vote-note">Votes are opinions from Threadsium accounts, one per account. They are not trading signals.</p>
      </section>

      <Suspense fallback={<Loom label="Loading the chart" />}>
        <TokenChart tokenAddress={address} tokenSymbol={symbol} decimals={meta?.decimals ?? 18} hypeUsd={hypeUsd} />
      </Suspense>

      <h2 className="section-title">Posts in this room</h2>
      <ComposerBox room={{ address, symbol }} placeholder={`Say something about $${symbol}`} />
      <Feed
        feedKey={`room:${address}:${symbol}:${user?.id ?? "anon"}`}
        load={(before, signal) => api.posts({ room: address, symbol: /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol) ? symbol : undefined, before }, signal)}
        accepts={(p) => p.roomAddress === address}
        loadingLabel={`Loading posts about ${symbol}`}
        empty={
          <>
            <p>
              <strong>Nobody has posted about ${symbol} yet.</strong>
            </p>
            <p>Posts written here, and posts anywhere that mention ${symbol} or its address, show up in this room.</p>
          </>
        }
      />
    </>
  );
}
