import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import "./landing-crt.css";
import { Avatar, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconVerified } from "../components/icons";
import { SentimentBar } from "../components/Sentiment";
import { TopBar } from "../components/Shell";
import { CHAIN } from "../config/chain";
import { api, type Post, type RoomToken } from "../lib/api";
import { ago, fmtCompact } from "../lib/format";
import { useApp } from "../state";

/* ───────── shared static noise ─────────
   Every "static" screen registers its canvas here. One requestAnimationFrame loop repaints them all
   from a pre-filled random bank, and it only runs while the hero is on screen and the tab is visible. */

const NOISE_W = 96;
const NOISE_H = 72;
const noiseCanvases = new Set<HTMLCanvasElement>();
let noiseBank: Uint32Array | null = null;

function bank(): Uint32Array {
  if (noiseBank) return noiseBank;
  const b = new Uint32Array(NOISE_W * NOISE_H * 3);
  for (let i = 0; i < b.length; i++) {
    // Plain grey snow to match the monochrome landing.
    const v = (Math.random() * 255) | 0;
    const r = v;
    const g = v;
    const bl = v;
    b[i] = 0xff000000 | (bl << 16) | (g << 8) | r;
  }
  noiseBank = b;
  return b;
}

function paintNoise(c: HTMLCanvasElement): void {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(NOISE_W, NOISE_H);
  const src = bank();
  const n = NOISE_W * NOISE_H;
  const off = (Math.random() * (src.length - n)) | 0;
  new Uint32Array(img.data.buffer).set(src.subarray(off, off + n));
  ctx.putImageData(img, 0, 0);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Runs the noise loop and measures the real frame rate for the viewfinder. Returns null fps when motion is reduced. */
function useBroadcast(heroRef: React.RefObject<HTMLElement | null>): number | null {
  const [fps, setFps] = useState<number | null>(null);
  useEffect(() => {
    if (prefersReducedMotion()) {
      noiseCanvases.forEach(paintNoise);
      return;
    }
    let raf = 0;
    let onScreen = true;
    let frames = 0;
    let since = performance.now();
    let tick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      frames++;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
      }
      // Static at roughly 30 frames a second looks like broadcast snow without burning the CPU.
      if (++tick % 2 === 0) noiseCanvases.forEach(paintNoise);
    };
    const start = () => {
      if (!raf && onScreen && !document.hidden) {
        frames = 0;
        since = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    if (heroRef.current) io.observe(heroRef.current);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    start();
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [heroRef]);
  return fps;
}

function StaticScreen(): React.ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    noiseCanvases.add(c);
    paintNoise(c);
    return () => {
      noiseCanvases.delete(c);
    };
  }, []);
  return (
    <div className="scr scr-static">
      <canvas ref={ref} width={NOISE_W} height={NOISE_H} />
      <span className="scr-roll" />
    </div>
  );
}

function BarsScreen(): React.ReactElement {
  return (
    <div className="scr scr-bars">
      <span className="bars-top" />
      <span className="bars-mid" />
      <span className="bars-low" />
    </div>
  );
}

function TokenScreen({ token, ch, size }: { token: RoomToken | undefined; ch: number; size: number }): React.ReactElement {
  if (!token) return <StaticScreen />;
  return (
    <div className="scr scr-token">
      <span className="osd osd-tl">CH {String(ch).padStart(2, "0")}</span>
      <TokenMark address={token.address} symbol={token.symbol} size={size} imageUrl={token.imageUrl} />
      <strong>${token.symbol}</strong>
    </div>
  );
}

function PostScreen({ post }: { post: Post | undefined }): React.ReactElement {
  if (!post) return <TestCard />;
  return (
    <div className="scr scr-post">
      <span className="tt-bar">
        <span>P{CHAIN.id}</span>
        <span>THREADSIUM</span>
      </span>
      <span className="tt-handle">@{post.author.username}</span>
      <span className="tt-body">{post.content}</span>
    </div>
  );
}

function BlockScreen({ block }: { block: number | null }): React.ReactElement {
  return (
    <div className="scr scr-block">
      <span className="osd osd-tl">LIVE</span>
      <span className="blk-label">BLOCK</span>
      <span className="blk-num">{block ? block.toLocaleString("en-US") : "– – –"}</span>
    </div>
  );
}

function TestCard(): React.ReactElement {
  return (
    <div className="scr scr-card">
      <span className="card-ring">
        <span>ELYSIUM</span>
        <b>{CHAIN.id}</b>
      </span>
    </div>
  );
}

type Screen = "static" | "bars" | "token" | "post" | "block" | "card";
type Body = "dark" | "beige" | "box";
interface TvSpec {
  x: number;
  y: number;
  w: number;
  r: number;
  d: number;
  screen: Screen;
  body: Body;
  n?: number;
  hideSmall?: boolean;
  glow: string;
}

/* Positions are percentages of the hero card. The middle column stays clear for the copy. */
const WALL: TvSpec[] = [
  { x: 1, y: 4, w: 180, r: -7, d: 0.5, screen: "static", body: "box", glow: "244,245,240" },
  { x: 3, y: 34, w: 150, r: 5, d: 1.1, screen: "token", body: "dark", n: 0, glow: "220,220,220", hideSmall: true },
  { x: 1, y: 60, w: 190, r: 3, d: 0.7, screen: "bars", body: "dark", glow: "160,160,160", hideSmall: true },
  { x: 9, y: 84, w: 140, r: -5, d: 1.3, screen: "post", body: "beige", n: 1, glow: "220,220,220" },
  { x: 24, y: 2, w: 108, r: 4, d: 0.3, screen: "token", body: "dark", n: 2, glow: "160,160,160", hideSmall: true },
  { x: 63, y: 2, w: 124, r: -3, d: 0.35, screen: "static", body: "dark", glow: "244,245,240" },
  { x: 81, y: 5, w: 190, r: 6, d: 0.8, screen: "post", body: "box", n: 0, glow: "160,160,160" },
  { x: 85, y: 36, w: 140, r: -6, d: 1.2, screen: "token", body: "beige", n: 1, glow: "200,200,200", hideSmall: true },
  { x: 83, y: 59, w: 168, r: 3, d: 0.6, screen: "card", body: "dark", glow: "244,245,240", hideSmall: true },
  { x: 79, y: 83, w: 176, r: -4, d: 1, screen: "static", body: "box", glow: "244,245,240" },
  { x: 66, y: 88, w: 120, r: 5, d: 1.4, screen: "block", body: "dark", glow: "220,220,220" },
];

function Tv({ spec, tokens, posts, block, index }: { spec: TvSpec; tokens: RoomToken[]; posts: Post[]; block: number | null; index: number }): React.ReactElement {
  const style = {
    "--x": `${spec.x}%`,
    "--y": `${spec.y}%`,
    "--w": spec.w,
    "--r": `${spec.r}deg`,
    "--d": spec.d,
    "--glow": spec.glow,
    "--delay": `${-index * 1.7}s`,
  } as React.CSSProperties;
  let screen: React.ReactElement;
  switch (spec.screen) {
    case "static":
      screen = <StaticScreen />;
      break;
    case "bars":
      screen = <BarsScreen />;
      break;
    case "token":
      screen = <TokenScreen token={tokens[spec.n ?? 0]} ch={(spec.n ?? 0) + 3} size={Math.round(spec.w * 0.24)} />;
      break;
    case "post":
      screen = <PostScreen post={posts[spec.n ?? 0]} />;
      break;
    case "block":
      screen = <BlockScreen block={block} />;
      break;
    default:
      screen = <TestCard />;
  }
  return (
    <div className={`tv-slot${spec.hideSmall ? " tv-hide-small" : ""}`} style={style}>
      <div className={`tv tv-${spec.body}`}>
        <div className="tv-glass">{screen}</div>
        {spec.body === "box" ? (
          <span className="tv-knobs">
            <i />
            <i />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ───────── viewfinder HUD ───────── */

function useClock(): { date: string; tc: string } {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  const s = Math.floor((now - startedAt) / 1000);
  return {
    date: `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear() % 100)}`,
    tc: `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`,
  };
}

function Viewfinder({ fps }: { fps: number | null }): React.ReactElement {
  const { date, tc } = useClock();
  return (
    <div className="vf" aria-hidden="true">
      <span className="vf-corner vf-tl" />
      <span className="vf-corner vf-tr" />
      <span className="vf-corner vf-bl" />
      <span className="vf-corner vf-br" />
      <span className="vf-txt vf-txt-tl">{fps ? `${fps} fps` : "still"}</span>
      <span className="vf-txt vf-txt-tr">
        <i className="vf-rec" /> REC
      </span>
      <span className="vf-txt vf-txt-bl">[{date}]</span>
      <span className="vf-txt vf-txt-br">[{tc}]</span>
    </div>
  );
}

/* ───────── on air: one big set that flips between token rooms ───────── */

function OnAir({ rooms, tokensLive }: { rooms: RoomToken[]; tokensLive: boolean }): React.ReactElement {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(0);
  const count = rooms.length;
  const idx = count ? ((i % count) + count) % count : 0;
  const t = count ? rooms[idx] : undefined;
  const tune = (next: number) => {
    if (next === i) return;
    setI(next);
    setFlip((f) => f + 1);
  };
  return (
    <section className="land-section air" aria-labelledby="air-title">
      <div className="air-head">
        <p className="air-kicker">
          <i className="vf-rec" aria-hidden="true" /> On air
        </p>
        <h2 id="air-title">A room for every token</h2>
        <p>
          Mention a $TICKER or paste a contract address and the post links to that token's room. Each room has the price chart, a bullish or bearish vote, a star rating
          and every post about the token.
        </p>
      </div>

      <div className="air-channels" role="group" aria-label="Choose a token room">
        {rooms.map((r, n) => (
          <button
            type="button"
            key={r.address}
            className={`air-ch${n === idx ? " is-on" : ""}`}
            aria-pressed={n === idx}
            onClick={() => tune(n)}
          >
            <TokenMark address={r.address} symbol={r.symbol} size={40} imageUrl={r.imageUrl} />
            <span>${r.symbol}</span>
          </button>
        ))}
      </div>

      <div className="air-stage">
        <button type="button" className="btn btn-ghost btn-small air-prev" onClick={() => tune(idx - 1 < 0 ? count - 1 : idx - 1)} disabled={count < 2}>
          Previous
        </button>
        <div className="air-tv">
          <div className="air-glass" aria-live="polite">
            {t ? (
              <div className="air-room" key={t.address}>
                <span className="osd osd-tl">CH {String(idx + 3).padStart(2, "0")}</span>
                <span className="osd osd-tr">▶ PLAY</span>
                <TokenMark address={t.address} symbol={t.symbol} size={84} imageUrl={t.imageUrl} />
                <strong className="air-sym">${t.symbol}</strong>
                <span className="air-name">{t.name}</span>
                <span className="air-depth">
                  {tokensLive ? (t.hypeDepth > 0 ? `${fmtCompact(t.hypeDepth, 1)} HYPE in pools` : "No pool depth found") : "Reading pools…"}
                </span>
                <SentimentBar bullish={t.bullishCount} bearish={t.bearishCount} />
              </div>
            ) : (
              <div className="air-room">
                <span className="osd osd-tl">NO SIGNAL</span>
                <Loom compact label="Tuning in to token rooms" />
              </div>
            )}
            {flip ? <span className="air-flip" key={flip} aria-hidden="true" /> : null}
          </div>
          <span className="air-tv-badge" aria-hidden="true">
            THREADSIUM
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-small air-next" onClick={() => tune((idx + 1) % Math.max(count, 1))} disabled={count < 2}>
          Next
        </button>
      </div>

      {t ? (
        <div className="air-foot">
          <ul className="air-tags" aria-label="Room details">
            <li className="chip">${t.symbol}</li>
            {t.venueBadge ? <li className="chip">{t.venueBadge}</li> : null}
            {t.launchpad ? <li className="chip">{t.launchpad}</li> : null}
          </ul>
          <Link to={`/app/token/${t.address}`} className="btn btn-primary">
            Open the ${t.symbol} room →
          </Link>
        </div>
      ) : null}
      <div className="air-links">
        <Link to="/app/rooms" className="land-more">
          Browse all rooms
        </Link>
        <Link to="/app/launchpads" className="land-more">
          Explore 20 Elysium launchpads →
        </Link>
      </div>
    </section>
  );
}

/* ───────── page ───────── */

export function Landing(): React.ReactElement {
  const { tokens, tokensLive, user, block, hypeUsd } = useApp();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [failed, setFailed] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const wall = useRef<HTMLDivElement>(null);
  const fps = useBroadcast(hero);

  useEffect(() => {
    api
      .posts({})
      .then((r) => setPosts(r.posts.filter((p) => p.content).slice(0, 6)))
      .catch(() => setFailed(true));
  }, []);

  // Pointer parallax: sets closer to the camera drift further.
  useEffect(() => {
    const el = hero.current;
    if (!el || prefersReducedMotion() || !window.matchMedia("(pointer: fine)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        wall.current?.style.setProperty("--px", px.toFixed(3));
        wall.current?.style.setProperty("--py", py.toFixed(3));
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const rooms = [...tokens].sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth).slice(0, 6);
  const totalDepth = tokens.reduce((acc, t) => acc + (t.hypeDepth || 0), 0);
  const live = posts?.slice(0, 4) ?? [];

  return (
    <div className="landing crt">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar app={false} />
      <main id="main">
        <section className="crt-hero" ref={hero} aria-labelledby="crt-title">
          {/* Background plate generated with Nano Banana (Gemini): a dark broadcast studio in the Elysium palette. */}
          <div className="crt-photo" aria-hidden="true" />
          <div className="crt-wall" ref={wall} aria-hidden="true">
            {WALL.map((s, i) => (
              <Tv key={i} spec={s} index={i} tokens={rooms} posts={posts ?? []} block={block} />
            ))}
          </div>
          <div className="crt-scan" aria-hidden="true" />
          <Viewfinder fps={fps} />
          <div className="crt-hero-copy">
            <div className="hero-eyebrow">
              <span className={`chain-dot${block ? " is-live" : ""}`} aria-hidden="true" />
              <span>Elysium · Chain {CHAIN.id}</span>
              <span className="hero-eyebrow-sep" aria-hidden="true">
                ·
              </span>
              <span>{block ? `Block #${block.toLocaleString("en-US")}` : "RPC live"}</span>
            </div>
            <h1 id="crt-title">
              Where <span className="hero-accent">Elysium</span> talks.
            </h1>
            <p className="hero-lede">
              Threadsium is the social network for Elysium, chain {CHAIN.id}. Post, reply, repost and react. Follow the people who call it early. Every token gets a
              room with a chart drawn from its own swaps.
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
        </section>

        <OnAir rooms={rooms} tokensLive={tokensLive} />

        <section className="land-section about" aria-labelledby="about-title">
          <h2 id="about-title" className="sr-only">
            What Threadsium gives you
          </h2>
          <ul className="about-cards">
            <li className="about-card">
              <span className="about-screen" aria-hidden="true">
                <span className="about-icon">
                  <svg viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="6.5" />
                  </svg>
                </span>
              </span>
              <h3>A feed you already know how to use</h3>
              <p>
                Posts up to 500 characters with an image, replies in threads, reposts, quotes, five reactions, saved posts, direct messages and a Following tab. The feed is
                in time order. Nothing is ranked or promoted.
              </p>
            </li>
            <li className="about-card">
              <span className="about-screen" aria-hidden="true">
                <span className="about-icon">
                  <svg viewBox="0 0 20 20">
                    <path d="M10 3.5 16.5 15.5h-13Z" />
                  </svg>
                </span>
              </span>
              <h3>Charts from the chain, not from us</h3>
              <p>
                Candles are built in your browser from Swap logs on Elysium's V3 and V4 pools. When the chain or a price source is unreachable the page says so instead of
                showing an old number.
              </p>
            </li>
            <li className="about-card">
              <span className="about-screen" aria-hidden="true">
                <span className="about-icon">
                  <svg viewBox="0 0 20 20">
                    <rect x="4" y="4" width="12" height="12" rx="2" />
                  </svg>
                </span>
              </span>
              <h3>Your wallet stays optional</h3>
              <p>
                You never connect a wallet to read or post. If you want the verified mark, you sign one free message to prove an address is yours. Threadsium never asks for
                a transaction.
              </p>
            </li>
          </ul>
        </section>

        <section className="land-section live" aria-labelledby="live-title">
          <div className="live-card">
            <div className="live-head">
              <h2 id="live-title">
                <span className={`chain-dot${posts?.length ? " is-live" : ""}`} aria-hidden="true" /> Latest posts, live from the feed
              </h2>
              <Link to="/app" className="btn btn-ghost btn-small">
                Read the whole feed
              </Link>
            </div>
            {failed ? <p className="panel-note">The feed could not be reached right now. Open the app to try again.</p> : null}
            {!posts && !failed ? <Loom compact label="Loading the latest posts" /> : null}
            {posts && !posts.length ? <p className="panel-note">No posts yet. Yours could be the first.</p> : null}
            <ol className="live-list">
              {live.map((p) => (
                <li key={p.feedId}>
                  <Link to={`/app/post/${p.id}`} className="live-row">
                    <Avatar user={p.author} size={40} />
                    <span className="live-main">
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
                      <span className="live-body">{p.content}</span>
                      <span className="live-meta">
                        {p.reactionCount} {p.reactionCount === 1 ? "reaction" : "reactions"} · {p.replyCount} {p.replyCount === 1 ? "reply" : "replies"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
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
