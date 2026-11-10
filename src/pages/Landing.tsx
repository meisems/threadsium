import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import "@fontsource-variable/antonio/wght.css";
import "./landing-crt.css";
import { Avatar, TokenMark } from "../components/Avatar";
import { Loom, Mark } from "../components/brand";
import { IconVerified } from "../components/icons";
import { SentimentBar } from "../components/Sentiment";
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
    const v = (Math.random() * 255) | 0;
    b[i] = 0xff000000 | (v << 16) | (v << 8) | v;
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

/* Positions are percentages of the hero. The middle column stays clear for the headline. */
const WALL: TvSpec[] = [
  { x: 1, y: 11, w: 210, r: -7, d: 0.5, screen: "static", body: "box", glow: "190,205,210" },
  { x: 15, y: 36, w: 168, r: 5, d: 1.1, screen: "token", body: "dark", n: 0, glow: "159,193,49", hideSmall: true },
  { x: 2, y: 60, w: 228, r: 3, d: 0.7, screen: "bars", body: "dark", glow: "120,160,255", hideSmall: true },
  { x: 20, y: 80, w: 150, r: -5, d: 1.3, screen: "post", body: "beige", n: 1, glow: "120,230,200" },
  { x: 31, y: 7, w: 118, r: 4, d: 0.3, screen: "token", body: "dark", n: 2, glow: "139,108,255", hideSmall: true },
  { x: 60, y: 5, w: 140, r: -3, d: 0.35, screen: "static", body: "dark", glow: "190,205,210" },
  { x: 77, y: 9, w: 214, r: 6, d: 0.8, screen: "post", body: "box", n: 0, glow: "120,230,200" },
  { x: 86, y: 38, w: 158, r: -6, d: 1.2, screen: "token", body: "beige", n: 1, glow: "255,186,0", hideSmall: true },
  { x: 70, y: 57, w: 200, r: 3, d: 0.6, screen: "card", body: "dark", glow: "220,220,220", hideSmall: true },
  { x: 84, y: 76, w: 196, r: -4, d: 1, screen: "static", body: "box", glow: "190,205,210" },
  { x: 58, y: 82, w: 132, r: 5, d: 1.4, screen: "block", body: "dark", glow: "159,193,49" },
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

function Viewfinder({ fps, block, hypeUsd }: { fps: number | null; block: number | null; hypeUsd: number | null }): React.ReactElement {
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
      <span className="vf-txt vf-txt-tr2">
        {block ? `BLK ${block.toLocaleString("en-US")}` : `CHAIN ${CHAIN.id}`}
        {hypeUsd ? ` · HYPE $${hypeUsd.toFixed(2)}` : ""}
      </span>
      <span className="vf-txt vf-txt-bl">[{date}]</span>
      <span className="vf-txt vf-txt-br">[{tc}]</span>
    </div>
  );
}

/* ───────── nav ───────── */

function PillNav(): React.ReactElement {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <header className="crt-nav">
      <div className="crt-nav-wrap" ref={wrap}>
        <nav className="crt-pills" aria-label="Main">
          <Link to="/" className="crt-pill crt-pill-icon" aria-label="Threadsium home">
            <Mark size={18} />
          </Link>
          <button type="button" className={`crt-pill crt-pill-menu${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="crt-menu" onClick={() => setOpen((v) => !v)}>
            Menu
            <span className="crt-burger" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
          {user ? (
            <Link to={`/app/u/${user.username}`} className="crt-pill">
              @{user.username}
            </Link>
          ) : (
            <Link to="/auth" className="crt-pill">
              Sign in
            </Link>
          )}
        </nav>
        <div id="crt-menu" className="crt-menu" hidden={!open}>
          <Link to="/app" onClick={() => setOpen(false)}>
            <span>01</span> The feed
          </Link>
          <Link to="/app/rooms" onClick={() => setOpen(false)}>
            <span>02</span> Token rooms
          </Link>
          <Link to="/app/launchpads" onClick={() => setOpen(false)}>
            <span>03</span> Launchpads
          </Link>
          <Link to="/docs" onClick={() => setOpen(false)}>
            <span>04</span> Docs
          </Link>
          {user ? null : (
            <Link to="/auth?mode=new" className="crt-menu-cta" onClick={() => setOpen(false)}>
              Create an account →
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/* ───────── on air: one big set that flips between token rooms ───────── */

function OnAir({ rooms, tokensLive }: { rooms: RoomToken[]; tokensLive: boolean }): React.ReactElement {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(0);
  const count = rooms.length;
  const t = count ? rooms[((i % count) + count) % count] : undefined;
  const go = (delta: number) => {
    setI((v) => v + delta);
    setFlip((f) => f + 1);
  };
  const ch = count ? (((i % count) + count) % count) + 3 : 3;
  return (
    <section className="crt-air" aria-labelledby="crt-air-title">
      <h2 id="crt-air-title" className="crt-air-title">
        On air
      </h2>
      <p className="crt-air-sub">Every token gets a room: its chart, a bull or bear vote, a star rating and every post about it.</p>
      <div className="crt-air-stage">
        <button type="button" className="crt-ghost crt-air-prev" onClick={() => go(-1)} disabled={count < 2}>
          Previous
        </button>
        <div className="air-tv">
          <div className="air-glass" aria-live="polite">
            {t ? (
              <div className="air-room" key={t.address}>
                <span className="osd osd-tl">CH {String(ch).padStart(2, "0")}</span>
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
        </div>
        <button type="button" className="crt-ghost crt-air-next" onClick={() => go(1)} disabled={count < 2}>
          Next
        </button>
      </div>
      {t ? (
        <>
          <ul className="crt-tags" aria-label="Room details">
            <li>[ ${t.symbol} ]</li>
            {t.venueBadge ? <li>[ {t.venueBadge} ]</li> : null}
            {t.launchpad ? <li>[ {t.launchpad} ]</li> : null}
          </ul>
          <Link to={`/app/token/${t.address}`} className="crt-split">
            <span>Open the room</span>
            <span aria-hidden="true">→</span>
          </Link>
        </>
      ) : null}
      <div className="crt-air-links">
        <Link to="/app/rooms">Browse all rooms</Link>
        <Link to="/app/launchpads">Explore 20 Elysium launchpads →</Link>
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

  // Pointer parallax: TVs closer to the camera drift further.
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
    <div className="crt">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PillNav />
      <main id="main">
        <section className="crt-hero" ref={hero} aria-labelledby="crt-title">
          <div className="crt-wall" ref={wall} aria-hidden="true">
            {WALL.map((s, i) => (
              <Tv key={i} spec={s} index={i} tokens={rooms} posts={posts ?? []} block={block} />
            ))}
          </div>
          <div className="crt-grain" aria-hidden="true" />
          <Viewfinder fps={fps} block={block} hypeUsd={hypeUsd} />
          <div className="crt-hero-copy">
            <h1 id="crt-title">
              <span>Where Elysium</span>
              <span className="crt-striped">talks.</span>
            </h1>
            <span className="crt-cross" aria-hidden="true" />
            <p className="crt-lede">
              The social network for Elysium, chain {CHAIN.id}. Post, reply, repost and react, and follow the people who call it early.
            </p>
            <div className="crt-cta">
              <Link className="crt-btn" to="/app">
                Open the feed
              </Link>
              {user ? (
                <Link className="crt-btn crt-btn-line" to={`/app/u/${user.username}`}>
                  Your profile
                </Link>
              ) : (
                <Link className="crt-btn crt-btn-line" to="/auth?mode=new">
                  Create an account
                </Link>
              )}
            </div>
            <dl className="crt-osd-strip" aria-label="Elysium on-chain overview">
              <div>
                <dt>Rooms</dt>
                <dd>{tokens.length} live</dd>
              </div>
              <div>
                <dt>Liquidity</dt>
                <dd>{tokensLive && totalDepth > 0 ? `${fmtCompact(totalDepth, 1)} HYPE` : "12 V3 · 6 V4"}</dd>
              </div>
              <div>
                <dt>HYPE</dt>
                <dd>{hypeUsd ? `$${hypeUsd.toFixed(2)}` : "On-chain"}</dd>
              </div>
            </dl>
          </div>
          <a href="#crt-air-title" className="crt-scroll">
            Scroll
          </a>
        </section>

        <OnAir rooms={rooms} tokensLive={tokensLive} />

        <section className="crt-about" aria-labelledby="crt-about-title">
          <div className="crt-about-head">
            <h2 id="crt-about-title">About</h2>
            <p>
              <b>Threadsium is the social network for Elysium, chain {CHAIN.id}.</b> Reading is open to everyone and joining takes a username and a password, no email.{" "}
              <b>Nothing is ranked or promoted, and every chart comes from the chain.</b>
            </p>
          </div>
          <ul className="crt-cards">
            <li className="crt-card">
              <span className="crt-card-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="6.5" />
                </svg>
              </span>
              <h3>A feed you already know how to use</h3>
              <p>
                Posts up to 500 characters with an image, threads, reposts, quotes, five reactions, saved posts, direct messages and a Following tab, in time order.
              </p>
            </li>
            <li className="crt-card">
              <span className="crt-card-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <path d="M10 3.5 16.5 15.5h-13Z" />
                </svg>
              </span>
              <h3>Charts from the chain, not from us</h3>
              <p>
                Candles are built in your browser from Swap logs on Elysium's V3 and V4 pools. When a source is unreachable the page says so instead of showing an old number.
              </p>
            </li>
            <li className="crt-card">
              <span className="crt-card-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20">
                  <rect x="4" y="4" width="12" height="12" rx="1" />
                </svg>
              </span>
              <h3>Your wallet stays optional</h3>
              <p>
                You never connect a wallet to read or post. For the verified mark you sign one free message. Threadsium never asks for a transaction.
              </p>
            </li>
          </ul>
        </section>

        <section className="crt-live" aria-labelledby="crt-live-title">
          <div className="crt-live-head">
            <h2 id="crt-live-title">
              <i className={`vf-rec${posts?.length ? "" : " is-idle"}`} aria-hidden="true" /> Live from the feed
            </h2>
            <Link to="/app" className="crt-btn crt-btn-line">
              Read the whole feed
            </Link>
          </div>
          {failed ? <p className="crt-note">The feed could not be reached right now. Open the app to try again.</p> : null}
          {!posts && !failed ? <Loom compact label="Loading the latest posts" /> : null}
          {posts && !posts.length ? <p className="crt-note">No posts yet. Yours could be the first.</p> : null}
          <ol className="crt-log">
            {live.map((p) => (
              <li key={p.feedId}>
                <Link to={`/app/post/${p.id}`} className="crt-log-row">
                  <span className="crt-log-time">{ago(p.createdAt)}</span>
                  <Avatar user={p.author} size={36} />
                  <span className="crt-log-main">
                    <span className="crt-log-name">
                      <b>{p.author.displayName}</b>
                      {p.author.walletVerified ? (
                        <span className="verified">
                          <IconVerified size={14} title="Verified wallet" />
                        </span>
                      ) : null}
                      <span>@{p.author.username}</span>
                    </span>
                    <span className="crt-log-body">{p.content}</span>
                    <span className="crt-log-meta">
                      {p.reactionCount} {p.reactionCount === 1 ? "reaction" : "reactions"} · {p.replyCount} {p.replyCount === 1 ? "reply" : "replies"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="crt-foot">
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
