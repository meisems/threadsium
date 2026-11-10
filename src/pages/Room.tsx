import React, { Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { ComposerBox } from "../components/Composer";
import { Feed } from "../components/Feed";
import { IconBack, IconClose, IconCopy, IconDown, IconExternal, IconShare, IconStar, IconUp } from "../components/icons";
import { useAuthGuard } from "../components/PostCard";
import { explorerToken } from "../config/chain";
import { api, type Post, type RoomStats } from "../lib/api";
import { fmtCompact, shortAddr } from "../lib/format";
import { postBus, useApp } from "../state";
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
  const address = raw.trim().replace(/^99901[-:]/, "").toLowerCase();
  const valid = /^0x[a-f0-9]{40}$/.test(address);
  const { tokenByAddress, hypeUsd, toast, user } = useApp();
  const guard = useAuthGuard();
  const known = tokenByAddress(address);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaState, setMetaState] = useState<"loading" | "ready" | "error">("loading");
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [voting, setVoting] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedTheme, setEmbedTheme] = useState<"dark" | "light">("dark");
  const [embedCompact, setEmbedCompact] = useState(false);
  const lastSyncRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setMeta(null);
    setMetaState("loading");
    setStats(null);
    lastSyncRef.current = Date.now();
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

  const symbol = meta?.symbol ?? known?.symbol ?? shortAddr(address);
  const name = meta?.name ?? known?.name ?? "Token";
  const description = known?.description || meta?.description || "";
  const launchpad = known?.launchpad ?? meta?.launchpad;
  const launchpadUrl = known?.launchpadUrl ?? meta?.launchpadUrl;

  // Real-time room sync: WebSocket stream + incremental polling fallback so posts/votes from other platforms appear live
  useEffect(() => {
    if (!valid) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(api.roomWsUrl(address));
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "post" && msg.post) {
              const p = msg.post as Post;
              if (p.createdAt > lastSyncRef.current) lastSyncRef.current = p.createdAt;
              postBus.emit({ type: "created", post: p });
              setStats((s) => (s ? { ...s, postCount: s.postCount + 1 } : s));
            } else if (msg.type === "post_updated" && msg.post) {
              postBus.emit({ type: "updated", post: msg.post as Post });
            } else if (msg.type === "post_deleted" && msg.postId) {
              postBus.emit({ type: "deleted", id: String(msg.postId) });
            } else if (msg.type === "vote" && msg.stats) {
              setStats((cur) => (cur ? { ...cur, ...msg.stats } : msg.stats));
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (!closed) retryTimer = setTimeout(connect, 6_000);
        };
        ws.onerror = () => ws?.close();
      } catch {
        /* fallback to polling */
      }
    };
    connect();

    const poll = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const sym = /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol) ? symbol : undefined;
      api
        .roomSync(address, { after: lastSyncRef.current, symbol: sym, limit: 15 })
        .then((res) => {
          if (closed) return;
          setStats(res.room);
          for (const p of [...res.posts].reverse()) {
            if (p.createdAt > lastSyncRef.current) lastSyncRef.current = p.createdAt;
            postBus.emit({ type: "created", post: p });
          }
        })
        .catch(() => undefined);
    }, 8_000);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(poll);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [address, valid, symbol]);

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

  const origin = typeof window !== "undefined" ? window.location.origin : "https://threadsium.xyz";
  const embedParams = new URLSearchParams();
  embedParams.set("theme", embedTheme);
  if (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol)) embedParams.set("symbol", symbol);
  if (embedCompact) embedParams.set("compact", "1");
  const embedUrl = `${origin}/embed/room/${address}?${embedParams.toString()}`;
  const iframeSnippet = `<iframe src="${embedUrl}" width="100%" height="${embedCompact ? 480 : 580}" style="border:0;border-radius:16px;overflow:hidden" allow="clipboard-write" loading="lazy" title="$${symbol} synced room on Threadsium"></iframe>`;
  const syncRestUrl = `${origin}/api/rooms/${address}/sync`;
  const syncChatUrl = `${origin}/api/chat/99901-${address}/messages`;
  const syncWsUrl = `${origin.replace(/^http/, "ws")}/api/rooms/${address}/ws`;

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast(`${label} copied`))
      .catch(() => toast("Copy is blocked in this browser", "error"));
  };

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
              onClick={() => copyText(address, "Contract address")}
            >
              {shortAddr(address, 8, 6)} <IconCopy size={14} />
            </button>
            <button
              type="button"
              className="chip chip-button"
              title="Embed or sync this token room on another Elysium platform"
              onClick={() => setEmbedOpen(true)}
            >
              Sync / Embed <IconShare size={14} />
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
            <Link to={`/embed/room/${address}`} target="_blank" rel="noopener noreferrer">
              Live widget <IconExternal size={14} />
            </Link>
            {known && known.hypeDepth > 0 ? <span>{fmtCompact(known.hypeDepth, 1)} HYPE in pools</span> : null}
          </div>
        </div>
      </header>

      {embedOpen ? (
        <div
          className="dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="embed-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEmbedOpen(false);
          }}
        >
          <div className="dialog embed-dialog">
            <div className="dialog-head">
              <h2 id="embed-dialog-title">Sync or embed the ${symbol} room</h2>
              <button type="button" className="icon-btn icon-btn-quiet" aria-label="Close" onClick={() => setEmbedOpen(false)}>
                <IconClose size={20} />
              </button>
            </div>
            <div className="embed-dialog-body">
              <p>
                Every token on Elysium (chain 99901) shares one live room (`99901-{shortAddr(address, 6, 4)}`). Any launchpad, DEX, analytics site or Prediction Market can
                embed this room or connect to its live stream so everyone talks in the same chat.
              </p>

              <div className="embed-dialog-controls">
                <div className="segmented" role="group" aria-label="Embed theme">
                  <button
                    type="button"
                    className={embedTheme === "dark" ? "is-on" : ""}
                    aria-pressed={embedTheme === "dark"}
                    onClick={() => setEmbedTheme("dark")}
                  >
                    Night
                  </button>
                  <button
                    type="button"
                    className={embedTheme === "light" ? "is-on" : ""}
                    aria-pressed={embedTheme === "light"}
                    onClick={() => setEmbedTheme("light")}
                  >
                    Day
                  </button>
                </div>
                <label className="embed-check">
                  <input type="checkbox" checked={embedCompact} onChange={(e) => setEmbedCompact(e.target.checked)} />
                  <span>Compact header</span>
                </label>
                <a href={embedUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-small">
                  Preview widget <IconExternal size={14} />
                </a>
              </div>

              <div className="embed-code-block">
                <div className="embed-code-label">
                  <strong>1. Drop-in iframe widget</strong>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => copyText(iframeSnippet, "Iframe code")}>
                    <IconCopy size={14} /> Copy iframe
                  </button>
                </div>
                <pre className="mono">{iframeSnippet}</pre>
              </div>

              <div className="embed-code-block">
                <div className="embed-code-label">
                  <strong>2. Cross-platform JSON &amp; WebSocket sync (CORS enabled)</strong>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => copyText(syncRestUrl, "Sync API URL")}>
                    <IconCopy size={14} /> Copy REST URL
                  </button>
                </div>
                <ul className="embed-endpoint-list mono">
                  <li>
                    <span>GET</span> {syncRestUrl}
                  </li>
                  <li>
                    <span>GET/POST</span> {syncChatUrl}
                  </li>
                  <li>
                    <span>WS</span> {syncWsUrl}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
