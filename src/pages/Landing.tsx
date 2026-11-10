import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { Avatar, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconVerified } from "../components/icons";
import { TopBar } from "../components/Shell";
import { CHAIN } from "../config/chain";
import { api, type Post } from "../lib/api";
import { ago, fmtCompact } from "../lib/format";
import { useApp } from "../state";
import { SentimentBar } from "../components/Sentiment";

function LiveThread(): React.ReactElement {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .posts({})
      .then((r) => setPosts(r.posts.filter((p) => p.content).slice(0, 3)))
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="live-thread" aria-label="Latest posts on Threadsium">
      <p className="live-thread-title">
        <span className="chain-dot is-live" aria-hidden="true" /> Latest posts, live from the feed
      </p>
      {failed ? <p className="panel-note">The feed could not be reached right now. Open the app to try again.</p> : null}
      {!posts && !failed ? <Loom compact label="Loading the latest posts" /> : null}
      {posts && !posts.length ? <p className="panel-note">No posts yet. Yours could be the first.</p> : null}
      <ol className="live-thread-list">
        {posts?.map((p) => (
          <li key={p.feedId}>
            <Link to={`/app/post/${p.id}`} className="live-post">
              <span className="live-post-gutter">
                <Avatar user={p.author} size={36} />
              </span>
              <span className="live-post-main">
                <span className="name-line">
                  <span className="name-display">{p.author.displayName}</span>
                  {p.author.walletVerified ? (
                    <span className="verified">
                      <IconVerified size={14} title="Verified wallet" />
                    </span>
                  ) : null}
                  <span className="name-handle">@{p.author.username}</span>
                  <span className="name-time">{ago(p.createdAt)}</span>
                </span>
                <span className="live-post-body">{p.content}</span>
                <span className="live-post-meta">
                  {p.reactionCount} {p.reactionCount === 1 ? "reaction" : "reactions"}, {p.replyCount} {p.replyCount === 1 ? "reply" : "replies"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <Link to="/app" className="live-thread-more">
        Read the whole feed
      </Link>
    </div>
  );
}

export function Landing(): React.ReactElement {
  const { tokens, tokensLive, user, block, hypeUsd } = useApp();
  const rooms = [...tokens].sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth).slice(0, 6);
  const totalDepth = tokens.reduce((acc, t) => acc + (t.hypeDepth || 0), 0);
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar app={false} />
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <span className={`chain-dot${block ? " is-live" : ""}`} aria-hidden="true" />
              <span>Elysium · Chain {CHAIN.id}</span>
              <span className="hero-eyebrow-sep" aria-hidden="true">·</span>
              <span>{block ? `Block #${block.toLocaleString("en-US")}` : "RPC live"}</span>
            </div>
            <h1>
              Where <span className="hero-accent">Elysium</span> talks.
            </h1>
            <p className="hero-lede">
              Threadsium is the social network for Elysium, chain 99901. Post, reply, repost and react. Follow the people who call it early. Every token gets a room with a
              chart drawn from its own swaps.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-nitro btn-large" to="/app">
                Open the feed
              </Link>
              {user ? (
                <Link className="btn btn-royal-ghost btn-large" to={`/app/u/${user.username}`}>
                  Your profile
                </Link>
              ) : (
                <Link className="btn btn-royal-ghost btn-large" to="/auth?mode=new">
                  Create an account
                </Link>
              )}
            </div>
            <p className="hero-note">Reading is open to everyone. Joining takes a username and a password, no email.</p>
            <dl className="hero-nitro-strip" aria-label="Elysium on-chain overview">
              <div>
                <dt>Token rooms</dt>
                <dd>{tokens.length} live</dd>
              </div>
              <div>
                <dt>Indexed liquidity</dt>
                <dd>{tokensLive && totalDepth > 0 ? `${fmtCompact(totalDepth, 1)} HYPE` : "12 V3 · 6 V4"}</dd>
              </div>
              <div>
                <dt>HYPE reference</dt>
                <dd>{hypeUsd ? `$${hypeUsd.toFixed(2)}` : "On-chain"}</dd>
              </div>
            </dl>
          </div>
          <LiveThread />
        </section>

        <section className="land-section">
          <div className="land-section-head">
            <h2>A room for every token</h2>
            <p>
              Mention a $TICKER or paste a contract address and the post links to that token's room. Each room has the price chart, a bullish or bearish vote, a star rating
              and every post about the token.
            </p>
          </div>
          <ul className="land-rooms">
            {rooms.map((t) => (
              <li key={t.address}>
                <Link to={`/app/token/${t.address}`} className="land-room">
                  <TokenMark address={t.address} symbol={t.symbol} size={44} imageUrl={t.imageUrl} />
                  <span className="land-room-main">
                    <strong>${t.symbol}</strong>
                    <span>{t.name}</span>
                  </span>
                  <span className="land-room-side">
                    <span>{tokensLive ? (t.hypeDepth > 0 ? `${fmtCompact(t.hypeDepth, 1)} HYPE in pools` : "no pool depth found") : "reading pools…"}</span>
                    <SentimentBar bullish={t.bullishCount} bearish={t.bearishCount} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <Link to="/app/rooms" className="land-more">
              Browse all rooms
            </Link>
            <Link to="/app/launchpads" className="land-more">
              Explore 20 Elysium launchpads →
            </Link>
          </div>
        </section>

        <section className="land-section land-trio">
          <div>
            <h3>A feed you already know how to use</h3>
            <p>
              Posts up to 500 characters with an image, replies in threads, reposts, quotes, five reactions, saved posts, direct messages and a Following tab. The feed is in
              time order. Nothing is ranked or promoted.
            </p>
          </div>
          <div>
            <h3>Charts from the chain, not from us</h3>
            <p>
              Candles are built in your browser from Swap logs on Elysium's V3 and V4 pools. When the chain or a price source is unreachable the page says so instead of
              showing an old number.
            </p>
          </div>
          <div>
            <h3>Your wallet stays optional</h3>
            <p>
              You never connect a wallet to read or post. If you want the verified mark, you sign one free message to prove an address is yours. Threadsium never asks for
              a transaction.
            </p>
          </div>
        </section>
      </main>
      <footer className="land-foot">
        <span>Threadsium, a community project for Elysium (chain {CHAIN.id}). Not run by Kinetiq. Nothing here is financial advice.</span>
        <nav aria-label="Footer">
          <Link to="/docs">Docs</Link>
          <Link to="/docs#privacy">Privacy</Link>
          <Link to="/docs#limits">Limits</Link>
          <a href={CHAIN.explorer} target="_blank" rel="noopener noreferrer">
            Block explorer
          </a>
        </nav>
      </footer>
    </div>
  );
}
