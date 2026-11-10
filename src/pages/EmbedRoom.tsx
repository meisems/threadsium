import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Avatar, TokenMark, WEAVES } from "../components/Avatar";
import { Loom, Mark } from "../components/brand";
import { IconDown, IconExternal, IconUp, IconVerified, ReactionGlyph } from "../components/icons";
import { SentimentBar } from "../components/Sentiment";
import { ThemeControl } from "../components/ThemeControl";
import { api, type Post, type ReactionKind, type RoomStats } from "../lib/api";
import { ago, shortAddr } from "../lib/format";
import { useApp } from "../state";

function normalizeAddr(raw: string): string {
  const m = raw.trim().match(/^(?:99901[-:])?(0x[a-fA-F0-9]{40})$/);
  return m ? m[1].toLowerCase() : "";
}

function notifyParent(payload: Record<string, unknown>): void {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "threadsium-room", chainId: 99901, ...payload }, "*");
    }
  } catch {
    /* ignore cross-origin frame restrictions */
  }
}

export function EmbedRoom(): React.ReactElement {
  const { address: rawParam = "" } = useParams();
  const [searchParams] = useSearchParams();
  const address = normalizeAddr(rawParam);
  const valid = /^0x[a-f0-9]{40}$/.test(address);

  const { user, setUser, tokenByAddress, toast } = useApp();
  const known = tokenByAddress(address);

  const symbolParam = (searchParams.get("symbol") || "").replace(/^\$/, "").toUpperCase();
  const compact = searchParams.get("compact") === "1";
  const hostPlatform = searchParams.get("platform") || "";

  const [metaSymbol, setMetaSymbol] = useState<string>(symbolParam || known?.symbol || "");
  const [metaName, setMetaName] = useState<string>(known?.name || "");
  const [stats, setStats] = useState<RoomStats | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [liveMode, setLiveMode] = useState<"ws" | "poll">("poll");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voting, setVoting] = useState(false);

  // Inline auth state for third-party iframe embeds
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [preset, setPreset] = useState(WEAVES[0].id);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const latestTsRef = useRef<number>(0);

  // Sync theme with ?theme=dark|light query param or parent postMessage
  useEffect(() => {
    const paramTheme = searchParams.get("theme");
    if (paramTheme === "light" || paramTheme === "dark") {
      document.documentElement.setAttribute("data-theme", paramTheme);
      document.documentElement.style.colorScheme = paramTheme;
    }
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (d && typeof d === "object" && (d.type === "threadsium:theme" || d.type === "theme")) {
        const next = d.theme === "light" ? "light" : d.theme === "dark" ? "dark" : null;
        if (next) {
          document.documentElement.setAttribute("data-theme", next);
          document.documentElement.style.colorScheme = next;
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [searchParams]);

  const symbol = metaSymbol || known?.symbol || shortAddr(address);
  const name = metaName || known?.name || "Elysium Token";

  const mergeIncomingPosts = useCallback((incoming: Post[]) => {
    if (!incoming.length) return;
    setPosts((cur) => {
      const byId = new Map(cur.map((p) => [p.id, p]));
      let changed = false;
      for (const p of incoming) {
        if (!byId.has(p.id)) changed = true;
        byId.set(p.id, p);
        if (p.createdAt > latestTsRef.current) latestTsRef.current = p.createdAt;
      }
      if (!changed && incoming.length === 1) {
        return cur.map((x) => (x.id === incoming[0].id ? incoming[0] : x));
      }
      return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    });
  }, []);

  // Initial room & token metadata load
  useEffect(() => {
    if (!valid) return;
    let alive = true;
    setState("loading");
    latestTsRef.current = 0;

    api
      .tokenMeta(address)
      .then((m) => {
        if (!alive) return;
        if (m.symbol) setMetaSymbol(m.symbol);
        if (m.name) setMetaName(m.name);
      })
      .catch(() => undefined);

    const symQuery = /^[A-Z][A-Z0-9]{0,11}$/.test(symbol) ? symbol : undefined;
    api
      .roomSync(address, { symbol: symQuery, limit: 30 })
      .then((res) => {
        if (!alive) return;
        setStats(res.room);
        setPosts(res.posts);
        for (const p of res.posts) {
          if (p.createdAt > latestTsRef.current) latestTsRef.current = p.createdAt;
        }
        setState("ready");
        notifyParent({ type: "ready", room: address, roomId: `99901-${address}`, postCount: res.room.postCount });
      })
      .catch(() => {
        if (alive) setState("error");
      });

    return () => {
      alive = false;
    };
  }, [address, valid, user?.id]);

  // Real-time WebSocket stream + incremental polling fallback
  useEffect(() => {
    if (!valid) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWs = () => {
      if (closed) return;
      try {
        ws = new WebSocket(api.roomWsUrl(address));
        ws.onopen = () => {
          if (!closed) setLiveMode("ws");
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg.type === "post" && msg.post) {
              mergeIncomingPosts([msg.post as Post]);
              setStats((s) => (s ? { ...s, postCount: s.postCount + 1 } : s));
              notifyParent({ type: "post", room: address, post: msg.post });
            } else if (msg.type === "post_updated" && msg.post) {
              mergeIncomingPosts([msg.post as Post]);
            } else if (msg.type === "post_deleted" && msg.postId) {
              setPosts((cur) => cur.filter((p) => p.id !== msg.postId));
            } else if (msg.type === "vote" && msg.stats) {
              setStats((cur) => (cur ? { ...cur, ...msg.stats } : msg.stats));
              notifyParent({ type: "vote", room: address, stats: msg.stats });
            }
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onclose = () => {
          if (closed) return;
          setLiveMode("poll");
          reconnectTimer = setTimeout(connectWs, 5_000);
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        setLiveMode("poll");
      }
    };

    connectWs();

    const pollInterval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      const symQuery = /^[A-Z][A-Z0-9]{0,11}$/.test(symbol) ? symbol : undefined;
      api
        .roomSync(address, { after: latestTsRef.current || undefined, symbol: symQuery, limit: 20 })
        .then((res) => {
          if (closed) return;
          setStats(res.room);
          if (res.posts.length) mergeIncomingPosts(res.posts);
        })
        .catch(() => undefined);
    }, 6_000);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [address, valid, symbol, mergeIncomingPosts]);

  if (!valid) {
    return (
      <div className="embed-room">
        <div className="empty">
          <p>
            <strong>Invalid token room address.</strong>
          </p>
          <p>Pass a 0x contract address (or 99901-0x… room ID) in the URL.</p>
        </div>
      </div>
    );
  }

  const handleVote = async (sentiment: "bullish" | "bearish") => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (voting) return;
    setVoting(true);
    try {
      const next = stats?.mySentiment === sentiment ? null : sentiment;
      const r = await api.vote(address, { sentiment: next });
      setStats(r.room);
      notifyParent({ type: "vote", room: address, stats: r.room });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setVoting(false);
    }
  };

  const handleReact = async (post: Post, kind: ReactionKind) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    try {
      const next = post.viewer.reaction === kind ? null : kind;
      const r = await api.react(post.id, next);
      setPosts((cur) =>
        cur.map((p) =>
          p.id === post.id
            ? { ...p, reactionCount: r.reactionCount, reactions: r.reactions, viewer: { ...p.viewer, reaction: r.reaction } }
            : p,
        ),
      );
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await api.createPost({ content: text, roomAddress: address });
      setDraft("");
      mergeIncomingPosts([r.post]);
      setStats((s) => (s ? { ...s, postCount: s.postCount + 1 } : s));
      notifyParent({ type: "post", room: address, post: r.post });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  const handleEmbedAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authBusy) return;
    setAuthError("");
    setAuthBusy(true);
    try {
      const me =
        authMode === "login"
          ? await api.login(username.trim(), password, true)
          : await api.register(username.trim(), password, preset, true);
      setUser(me);
      setAuthOpen(false);
      setPassword("");
    } catch (err) {
      setAuthError((err as Error).message || "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className={`embed-room${compact ? " embed-room-compact" : ""}`}>
      <header className="embed-head">
        <div className="embed-head-top">
          <div className="embed-token">
            <TokenMark address={address} symbol={symbol} size={compact ? 32 : 38} />
            <div className="embed-token-text">
              <div className="embed-token-title">
                <strong>${symbol}</strong>
                <span className="embed-token-name">{name}</span>
              </div>
              <div className="embed-token-sub">
                <span className="chain-dot is-live" aria-hidden="true" />
                <span>{liveMode === "ws" ? "Synced live" : "Synced"} · 99901</span>
                {hostPlatform ? <span>· via {hostPlatform}</span> : null}
              </div>
            </div>
          </div>

          <div className="embed-head-actions">
            <ThemeControl compact />
            <a
              href={`/app/token/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-small embed-open-link"
              title="Open full token room & swap chart on Threadsium"
            >
              <Mark size={16} />
              <span>Room</span>
              <IconExternal size={13} />
            </a>
          </div>
        </div>

        <div className="embed-sentiment-row">
          <div className="vote-buttons" role="group" aria-label={`Vote on $${symbol}`}>
            <button
              type="button"
              className={`vote vote-bull btn-small${stats?.mySentiment === "bullish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bullish"}
              disabled={voting}
              onClick={() => handleVote("bullish")}
            >
              <IconUp size={15} /> Bull <span>{stats?.bullish ?? 0}</span>
            </button>
            <button
              type="button"
              className={`vote vote-bear btn-small${stats?.mySentiment === "bearish" ? " is-on" : ""}`}
              aria-pressed={stats?.mySentiment === "bearish"}
              disabled={voting}
              onClick={() => handleVote("bearish")}
            >
              <IconDown size={15} /> Bear <span>{stats?.bearish ?? 0}</span>
            </button>
          </div>
          <SentimentBar bullish={stats?.bullish ?? 0} bearish={stats?.bearish ?? 0} />
        </div>
      </header>

      <main className="embed-stream" aria-live="polite">
        {state === "loading" ? (
          <Loom compact label={`Syncing $${symbol} room`} />
        ) : state === "error" ? (
          <div className="notice notice-error">
            <p>Could not reach the room right now.</p>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                setState("loading");
                api
                  .roomSync(address, { limit: 30 })
                  .then((r) => {
                    setStats(r.room);
                    setPosts(r.posts);
                    setState("ready");
                  })
                  .catch(() => setState("error"));
              }}
            >
              Retry
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="empty embed-empty">
            <p>
              <strong>No messages in the ${symbol} room yet.</strong>
            </p>
            <p>Messages posted here or on any synced Elysium platform appear in this room immediately.</p>
          </div>
        ) : (
          <ol className="embed-list">
            {posts.map((p) => (
              <li key={p.feedId} className="embed-msg">
                <a href={`/app/u/${p.author.username}`} target="_blank" rel="noopener noreferrer" className="embed-msg-avatar">
                  <Avatar user={p.author} size={34} />
                </a>
                <div className="embed-msg-body">
                  <div className="name-line">
                    <a href={`/app/u/${p.author.username}`} target="_blank" rel="noopener noreferrer" className="name-display">
                      {p.author.displayName}
                    </a>
                    {p.author.walletVerified ? (
                      <span className="verified">
                        <IconVerified size={13} title="Verified wallet" />
                      </span>
                    ) : null}
                    <span className="name-handle">@{p.author.username}</span>
                    <a href={`/app/post/${p.id}`} target="_blank" rel="noopener noreferrer" className="name-time">
                      {ago(p.createdAt)}
                    </a>
                  </div>
                  <p className="embed-msg-text">{p.content}</p>
                  {p.imageUrl ? (
                    <a href={`/app/post/${p.id}`} target="_blank" rel="noopener noreferrer" className="embed-msg-img">
                      <img src={p.imageUrl} alt="Post attachment" loading="lazy" />
                    </a>
                  ) : null}
                  <div className="embed-msg-actions">
                    {(["like", "bull", "bear"] as ReactionKind[]).map((k) => {
                      const count = p.reactions[k] ?? 0;
                      const active = p.viewer.reaction === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          className={`embed-react-btn${active ? " is-on" : ""}`}
                          onClick={() => handleReact(p, k)}
                          aria-pressed={active}
                        >
                          <ReactionGlyph kind={k} size={15} />
                          {count > 0 ? <span>{count}</span> : null}
                        </button>
                      );
                    })}
                    <a href={`/app/post/${p.id}`} target="_blank" rel="noopener noreferrer" className="embed-reply-link">
                      {p.replyCount > 0 ? `${p.replyCount} ${p.replyCount === 1 ? "reply" : "replies"}` : "Reply"} ↗
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>

      <footer className="embed-foot">
        {authOpen && !user ? (
          <form className="embed-auth" onSubmit={handleEmbedAuth}>
            <div className="embed-auth-head">
              <strong>{authMode === "login" ? "Sign in to Threadsium" : "Create a Threadsium account"}</strong>
              <button type="button" className="link-btn" onClick={() => setAuthOpen(false)}>
                Cancel
              </button>
            </div>
            {authError ? (
              <p className="field-error" role="alert">
                {authError}
              </p>
            ) : null}
            <div className="embed-auth-fields">
              <input
                type="text"
                placeholder="Username"
                aria-label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={20}
              />
              <input
                type="password"
                placeholder="Password (8+ chars)"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            {authMode === "register" ? (
              <div className="embed-weave-row" role="radiogroup" aria-label="Choose avatar weave">
                {WEAVES.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={preset === w.id}
                    className={`chip${preset === w.id ? " is-on" : ""}`}
                    onClick={() => setPreset(w.id)}
                  >
                    {w.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="embed-auth-actions">
              <button type="submit" className="btn btn-primary btn-small" disabled={authBusy}>
                {authBusy ? "Working…" : authMode === "login" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setAuthMode(authMode === "login" ? "register" : "login");
                  setAuthError("");
                }}
              >
                {authMode === "login" ? "Need an account? Sign up" : "Have an account? Sign in"}
              </button>
            </div>
          </form>
        ) : user ? (
          <form className="embed-compose" onSubmit={handleSend}>
            <div className="embed-compose-row">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                placeholder={`Post to the synced $${symbol} room…`}
                aria-label={`Post to the synced $${symbol} room`}
              />
              <button type="submit" className="btn btn-primary btn-small" disabled={sending || !draft.trim()}>
                {sending ? "…" : "Send"}
              </button>
            </div>
            <div className="embed-compose-meta">
              <span>
                Posting as <strong>@{user.username}</strong> · synced across Elysium
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  api.logout().catch(() => undefined);
                  setUser(null);
                }}
              >
                Sign out
              </button>
            </div>
          </form>
        ) : (
          <div className="embed-signin-bar">
            <span>Synced room chat for ${symbol} on Elysium (99901).</span>
            <div className="embed-signin-btns">
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => {
                  setAuthMode("login");
                  setAuthOpen(true);
                }}
              >
                Sign in to chat
              </button>
              <Link to="/app" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-small">
                Open app ↗
              </Link>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
