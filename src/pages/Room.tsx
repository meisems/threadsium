import React, { Suspense, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { LaunchpadMark, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { ComposerBox } from "../components/Composer";
import { Feed } from "../components/Feed";
import {
  IconBack,
  IconClose,
  IconCopy,
  IconDown,
  IconExternal,
  IconShare,
  IconStar,
  IconUp,
} from "../components/icons";
import { useAuthGuard } from "../components/PostCard";
import { SentimentBar } from "../components/Sentiment";
import { SwapPanel } from "../components/SwapPanel";
import { RoomWhales } from "../components/WhaleSignals";
import { explorerToken } from "../config/chain";
import { tradeLinksForToken } from "../config/launchpads";
import { snippetOrigin } from "../config/site";
import { api, type MarketData, type Post, type RoomStats, type TokenMeta } from "../lib/api";
import { fmtCompact, fmtPrice, shortAddr } from "../lib/format";
import { postBus, useApp } from "../state";

// The charting library is the largest dependency; it loads only when a room is opened.
const TokenChart = React.lazy(() =>
  import("../components/TokenChart").then((m) => ({ default: m.TokenChart }))
);

/** "2.34K HYPE · $169.4K" (kept here so the header does not pull in the chart bundle). */
function fmtHypeUsd(hype: number | null | undefined, usd: number | null | undefined): string {
  if (!hype || !(hype > 0)) return "—";
  const h = `${fmtCompact(hype, hype < 10 ? 2 : 1)} HYPE`;
  return usd && usd > 0 ? `${h} · $${fmtCompact(usd, usd < 10 ? 2 : 1)}` : h;
}

interface Meta extends TokenMeta {
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
  const [metaState, setMetaState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [voting, setVoting] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedTheme, setEmbedTheme] = useState<"dark" | "light">("dark");
  const [embedCompact, setEmbedCompact] = useState(false);
  const [embedTab, setEmbedTab] = useState<"script" | "iframe" | "react" | "api" | "link">("script");
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
  const launchpad = meta?.launchpad ?? known?.launchpad ?? "Elysium";
  const launchpadId = meta?.launchpadId ?? known?.launchpadId ?? null;
  const launchpadUrl = meta?.launchpadUrl ?? known?.launchpadUrl;
  const isLaunchpadToken = Boolean(
    meta?.isLaunchpadToken ?? known?.isLaunchpadToken
  );
  const imageUrl = meta?.imageUrl ?? known?.imageUrl ?? null;

  const tradeLinks =
    meta?.tradeLinks ??
    tradeLinksForToken(address, launchpadId ?? launchpad);

  const volume24h = meta?.volume24h ?? known?.volume24h ?? null;
  const mcapHype = meta?.mcapHype ?? known?.mcapHype ?? null;
  const poolDepth =
    meta?.liquidityHype && meta.liquidityHype > 0
      ? meta.liquidityHype
      : known?.hypeDepth ?? 0;
  const holders = meta?.holders ?? known?.holders ?? null;

  // Market facts: read from the chain (GET /api/market, reported by the chart) when the token has a pool, otherwise
  // what its launchpad reports.
  const [market, setMarket] = useState<MarketData | null>(null);
  useEffect(() => setMarket(null), [address]);
  const onChainPrice = !!market?.priceHype;
  const stat = {
    onChain: onChainPrice,
    usd: market?.hypeUsd ?? hypeUsd ?? null,
    priceHype: market?.priceHype ?? meta?.priceHype ?? null,
    mcapHype: onChainPrice ? market!.mcapHype : mcapHype && mcapHype > 0 ? mcapHype : null,
    volume24h: market?.volume24hHype ?? (volume24h && volume24h > 0 ? volume24h : null),
    depth: market && market.liquidityHype > 0 ? market.liquidityHype : poolDepth,
    burnedPct: market && market.totalSupply > 0 && market.burned > 0 ? (market.burned / market.totalSupply) * 100 : meta?.burnedPct ?? null,
  };

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
              if (p.createdAt > lastSyncRef.current)
                lastSyncRef.current = p.createdAt;
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
      const sym = /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol)
        ? symbol
        : undefined;
      api
        .roomSync(address, {
          after: lastSyncRef.current,
          symbol: sym,
          limit: 15,
        })
        .then((res) => {
          if (closed) return;
          setStats(res.room);
          for (const p of [...res.posts].reverse()) {
            if (p.createdAt > lastSyncRef.current)
              lastSyncRef.current = p.createdAt;
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

  const origin = snippetOrigin();
  const height = embedCompact ? 480 : 580;
  const embedParams = new URLSearchParams();
  embedParams.set("theme", embedTheme);
  if (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol))
    embedParams.set("symbol", symbol);
  if (embedCompact) embedParams.set("compact", "1");
  const embedUrl = `${origin}/embed/room/${address}?${embedParams.toString()}`;
  const previewUrl = `/embed/room/${address}?${embedParams.toString()}`;
  const iframeSnippet = `<iframe src="${embedUrl}" width="100%" height="${height}" style="border:0;border-radius:16px;overflow:hidden" allow="clipboard-write" loading="lazy" title="$${symbol} room on Threadsium"></iframe>`;
  const scriptSnippet = `<div data-threadsium-room="${address}" data-theme="${embedTheme}" data-height="${height}"${embedCompact ? ' data-compact="1"' : ""}></div>
<script src="${origin}/widget.js" async></script>`;
  const reactSnippet = `export function ThreadsiumRoom({ address = "${address}", theme = "${embedTheme}", height = ${height} }) {
  return (
    <iframe
      src={\`${origin}/embed/room/\${address}?theme=\${theme}${embedCompact ? "&compact=1" : ""}\`}
      title="Threadsium room"
      loading="lazy"
      allow="clipboard-write"
      style={{ width: "100%", height, border: 0, borderRadius: 16 }}
    />
  );
}`;
  const apiSnippet = `const ROOM = "${address}";
const BASE = "${origin}";

// Room state and the latest posts (CORS is open for reads)
const { room, posts } = await fetch(\`\${BASE}/api/rooms/\${ROOM}/sync?limit=30\`).then((r) => r.json());

// Live updates: post, post_updated, post_deleted and vote events
const ws = new WebSocket(\`\${BASE.replace(/^http/, "ws")}/api/rooms/\${ROOM}/ws\`);
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "post") console.log("new post", msg.post);
};

// Price, market cap (HYPE and USD), liquidity and candles read from Elysium
const market = await fetch(\`\${BASE}/api/market/\${ROOM}?res=15m\`).then((r) => r.json());
console.log(market.priceHype, market.mcapHype, market.mcapUsd);`;
  const linkSnippet = `<a href="${origin}/app/token/${address}" target="_blank" rel="noopener">Discuss $${symbol} on Threadsium</a>`;
  const integrations = [
    { id: "script", label: "Script", title: "One script tag", note: "Paste where the room should appear and set its height with data-height. data-theme=\"auto\" follows your page's light or dark scheme, and the element fires threadsium:ready, threadsium:post and threadsium:vote events on the element.", code: scriptSnippet },
    { id: "iframe", label: "iframe", title: "Plain iframe", note: "No script: works in site builders, Notion-style pages and anywhere scripts are blocked. People can read, vote, react and post from inside it.", code: iframeSnippet },
    { id: "react", label: "React", title: "React component", note: "Drop this component into a React, Next.js or Vite app and pass a token address.", code: reactSnippet },
    { id: "api", label: "API", title: "Your own UI (REST + WebSocket)", note: "Read the room and its market data and render them your way. Reading needs no key. Posting needs a Threadsium account, so let people write through the widget.", code: apiSnippet },
    { id: "link", label: "Link", title: "Link or button", note: "The lightest option: send people to the room on Threadsium.", code: linkSnippet },
  ] as const;
  const integration = integrations.find((i) => i.id === embedTab) ?? integrations[0];

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast(`${label} copied`))
      .catch(() => toast("Copy is blocked in this browser", "error"));
  };

  const vote = async (v: {
    rating?: number | null;
    sentiment?: "bullish" | "bearish" | null;
  }) => {
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
        {launchpadId && launchpadId !== "kinetiq" ? (
          <Link to={`/app/launchpads/${launchpadId}`} className="back-link">
            <LaunchpadMark id={launchpadId} name={launchpad} size={18} />{" "}
            {launchpad} report
          </Link>
        ) : null}
      </div>

      <header className="room-head">
        <TokenMark
          address={address}
          symbol={symbol}
          size={64}
          imageUrl={imageUrl}
        />
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
            {launchpadId && launchpadId !== "kinetiq" ? (
              <Link
                to={`/app/launchpads/${launchpadId}`}
                className="chip chip-button"
                title={`View ${launchpad} launchpad rankings`}
              >
                <LaunchpadMark id={launchpadId} name={launchpad} size={16} />
                <span>{launchpad}</span>
              </Link>
            ) : null}
            {isLaunchpadToken ? (
              <span className="tag tag-verified">Launchpad token</span>
            ) : known?.featured || meta?.featured ? (
              <span className="tag tag-verified">Listed by its launchpad</span>
            ) : null}
            {metaState === "ready" && meta && !meta.onChain ? (
              <span className="tag tag-warn">Could not confirm on chain</span>
            ) : null}
            {metaState === "error" ? (
              <span className="tag tag-warn">Token details unavailable</span>
            ) : null}
          </div>
          {description ? <p className="room-head-desc">{description}</p> : null}

          {stat.mcapHype || stat.priceHype || stat.volume24h || stat.depth > 0 || holders || stat.burnedPct || meta?.creatorShareBps ? (
            <div className="room-launchpad-stats room-market-stats">
              {stat.priceHype ? (
                <span title={stat.onChain ? `Spot price in the deepest ${symbol} pool on Elysium` : `Reported by ${launchpad}`}>
                  Price: <strong>{fmtPrice(stat.priceHype)} HYPE</strong>
                  {stat.usd ? <em> {fmtPrice(stat.priceHype * stat.usd, "$")}</em> : null}
                </span>
              ) : null}
              {stat.mcapHype ? (
                <span
                  title={
                    stat.onChain
                      ? `Spot price × circulating supply (${fmtCompact(market?.circulating ?? 0, 2)} ${symbol}: total supply minus tokens at the dead and zero addresses), read from Elysium`
                      : `Reported by ${launchpad}`
                  }
                >
                  MCap: <strong>{fmtHypeUsd(stat.mcapHype, stat.usd ? stat.mcapHype * stat.usd : null)}</strong>
                </span>
              ) : null}
              {market?.fdvHype && market.fdvHype > (stat.mcapHype ?? 0) * 1.001 ? (
                <span title="Spot price × total supply">
                  FDV: <strong>{fmtHypeUsd(market.fdvHype, market.fdvUsd)}</strong>
                </span>
              ) : null}
              {stat.volume24h ? (
                <span title={market?.volume24hHype != null ? "HYPE traded in every pool of this token in the last 24 hours" : `Reported by ${launchpad}`}>
                  24h Vol: <strong>{fmtHypeUsd(stat.volume24h, stat.usd ? stat.volume24h * stat.usd : null)}</strong>
                </span>
              ) : null}
              {stat.depth > 0 ? (
                <span title={market ? `HYPE in ${market.pools.length} pool${market.pools.length === 1 ? "" : "s"} at the current price` : undefined}>
                  Liquidity: <strong>{fmtHypeUsd(stat.depth, stat.usd ? stat.depth * stat.usd : null)}</strong>
                </span>
              ) : null}
              {holders && holders > 0 ? (
                <span>
                  Holders: <strong>{holders}</strong>
                </span>
              ) : null}
              {stat.burnedPct && stat.burnedPct >= 0.05 ? (
                <span>
                  Burned: <strong>{stat.burnedPct.toFixed(1)}%</strong>
                </span>
              ) : null}
              {meta?.creatorShareBps && meta.creatorShareBps > 0 ? (
                <span>
                  Creator fee:{" "}
                  <strong>{(meta.creatorShareBps / 100).toFixed(2)}%</strong>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="room-head-links">
            <a
              href={explorerToken(address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Explorer <IconExternal size={14} />
            </a>
            {tradeLinks.map((tl) => (
              <a
                key={tl.url}
                href={tl.url}
                target="_blank"
                rel="noopener noreferrer"
                className={tl.primary ? "room-trade-primary" : ""}
              >
                Trade on {tl.label} <IconExternal size={14} />
              </a>
            ))}
            {!tradeLinks.length && launchpadUrl && launchpad ? (
              <a
                href={launchpadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {launchpad} <IconExternal size={14} />
              </a>
            ) : null}
            {meta?.website ? (
              <a
                href={meta.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                Website <IconExternal size={14} />
              </a>
            ) : null}
            {meta?.x ? (
              <a href={meta.x} target="_blank" rel="noopener noreferrer">
                X <IconExternal size={14} />
              </a>
            ) : null}
            {meta?.telegram ? (
              <a
                href={meta.telegram}
                target="_blank"
                rel="noopener noreferrer"
              >
                Telegram <IconExternal size={14} />
              </a>
            ) : null}
            <Link
              to={`/embed/room/${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Live widget <IconExternal size={14} />
            </Link>
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
              <h2 id="embed-dialog-title">
                Sync or embed the ${symbol} room
              </h2>
              <button
                type="button"
                className="icon-btn icon-btn-quiet"
                aria-label="Close"
                onClick={() => setEmbedOpen(false)}
              >
                <IconClose size={20} />
              </button>
            </div>
            <div className="embed-dialog-body">
              <p>
                Every token on Elysium (chain 99901) shares one live room (
                <code>99901-{shortAddr(address, 6, 4)}</code>). Any launchpad,
                DEX, analytics site or Prediction Market can embed this room or
                connect to its live stream so everyone talks in the same chat.
              </p>

              <div className="embed-dialog-controls">
                <div
                  className="segmented"
                  role="group"
                  aria-label="Embed theme"
                >
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
                  <input
                    type="checkbox"
                    checked={embedCompact}
                    onChange={(e) => setEmbedCompact(e.target.checked)}
                  />
                  <span>Compact header</span>
                </label>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-small"
                >
                  Preview widget <IconExternal size={14} />
                </a>
              </div>

              <div className="segmented embed-tabs" role="tablist" aria-label="Ways to integrate this room">
                {integrations.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    role="tab"
                    id={`embed-tab-${i.id}`}
                    aria-selected={embedTab === i.id}
                    aria-controls="embed-tab-panel"
                    className={embedTab === i.id ? "is-on" : ""}
                    onClick={() => setEmbedTab(i.id)}
                  >
                    {i.label}
                  </button>
                ))}
              </div>

              <div className="embed-code-block" role="tabpanel" id="embed-tab-panel" aria-labelledby={`embed-tab-${integration.id}`}>
                <div className="embed-code-label">
                  <strong>{integration.title}</strong>
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => copyText(integration.code, `${integration.title} code`)}
                  >
                    <IconCopy size={14} /> Copy
                  </button>
                </div>
                <p className="embed-code-note">{integration.note}</p>
                <pre className="mono">{integration.code}</pre>
              </div>

              <p className="embed-code-note">
                Every option shows the same room, so a post made on any site appears everywhere at once.{" "}
                <Link to="/docs/integrate" onClick={() => setEmbedOpen(false)}>
                  Integration guide
                </Link>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <section className="room-vote" aria-label="Room vote">
        <div className="room-vote-row">
          <div
            className="vote-buttons"
            role="group"
            aria-label="Your view on this token"
          >
            <button
              type="button"
              className={`vote vote-bull${stats?.mySentiment === "bullish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bullish"}
              disabled={voting}
              onClick={() =>
                vote({
                  sentiment:
                    stats?.mySentiment === "bullish" ? null : "bullish",
                })
              }
            >
              <IconUp size={18} /> Bullish <span>{stats?.bullish ?? 0}</span>
            </button>
            <button
              type="button"
              className={`vote vote-bear${stats?.mySentiment === "bearish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bearish"}
              disabled={voting}
              onClick={() =>
                vote({
                  sentiment:
                    stats?.mySentiment === "bearish" ? null : "bearish",
                })
              }
            >
              <IconDown size={18} /> Bearish <span>{stats?.bearish ?? 0}</span>
            </button>
          </div>
          <SentimentBar
            bullish={stats?.bullish ?? 0}
            bearish={stats?.bearish ?? 0}
          />
        </div>
        <div className="room-vote-row">
          <div
            className="stars"
            role="group"
            aria-label="Rate this token from 1 to 5"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star${(stats?.myRating ?? 0) >= n ? " is-on" : ""}`}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}${stats?.myRating === n ? ", your rating. Press to clear" : ""}`}
                aria-pressed={stats?.myRating === n}
                disabled={voting}
                onClick={() =>
                  vote({ rating: stats?.myRating === n ? null : n })
                }
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
        <p className="room-vote-note">
          Votes are opinions from Threadsium accounts, one per account. They are
          not trading signals.
        </p>
      </section>

      <Suspense fallback={<Loom label="Loading the chart" />}>
        <TokenChart
          tokenAddress={address}
          tokenSymbol={symbol}
          decimals={meta?.decimals ?? 18}
          hypeUsd={hypeUsd}
          onMarket={setMarket}
        />
      </Suspense>

      <div className="room-trade">
        <SwapPanel defaultOut={address} compact />
        <RoomWhales token={address} symbol={symbol} />
      </div>

      <h2 className="section-title">Posts in this room</h2>
      <ComposerBox
        room={{ address, symbol }}
        placeholder={`Say something about $${symbol}`}
      />
      <Feed
        feedKey={`room:${address}:${symbol}:${user?.id ?? "anon"}`}
        load={(before, signal) =>
          api.posts(
            {
              room: address,
              symbol: /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol)
                ? symbol
                : undefined,
              before,
            },
            signal
          )
        }
        accepts={(p) => p.roomAddress === address}
        loadingLabel={`Loading posts about ${symbol}`}
        empty={
          <>
            <p>
              <strong>Nobody has posted about ${symbol} yet.</strong>
            </p>
            <p>
              Posts written here, and posts anywhere that mention ${symbol} or
              its address, show up in this room.
            </p>
          </>
        }
      />
    </>
  );
}
