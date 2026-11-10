import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Avatar, TokenMark } from "../components/Avatar";
import { Loom } from "../components/brand";
import { PostCard } from "../components/PostCard";
import { api, type Person, type Post } from "../lib/api";
import { fmtCompact } from "../lib/format";
import { useApp } from "../state";

export function Search(): React.ReactElement {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const { tokens } = useApp();
  const [users, setUsers] = useState<Person[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (q.length < 2) {
      setState("idle");
      setUsers([]);
      setPosts([]);
      return;
    }
    const ctrl = new AbortController();
    setState("loading");
    api
      .search(q, ctrl.signal)
      .then((r) => {
        setUsers(r.users);
        setPosts(r.posts);
        setState("ready");
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e.message);
        setState("error");
      });
    return () => ctrl.abort();
  }, [q]);

  const rooms = useMemo(() => {
    const needle = q.replace(/^[$#@]/, "").toLowerCase();
    if (needle.length < 2 || q.startsWith("#") || q.startsWith("@")) return [];
    return tokens
      .filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || b.hypeDepth - a.hypeDepth)
      .slice(0, 6);
  }, [tokens, q]);

  return (
    <>
      <header className="page-head">
        <h1>{q ? `Results for “${q}”` : "Search"}</h1>
        {!q ? <p>Search people, posts, #tags and $tokens from the bar at the top. Paste a 0x address to open that token's room.</p> : null}
      </header>

      {q && q.length < 2 ? <p className="panel-note">Type at least two characters.</p> : null}

      {rooms.length ? (
        <section>
          <h2 className="section-title">Rooms</h2>
          <ul className="room-list room-list-compact">
            {rooms.map((t) => (
              <li key={t.address}>
                <Link to={`/app/token/${t.address}`} className="room-row">
                  <TokenMark address={t.address} symbol={t.symbol} size={38} />
                  <span className="room-row-main">
                    <span className="room-row-title">
                      <strong>${t.symbol}</strong>
                      <span>{t.name}</span>
                    </span>
                    <span className="room-row-meta">
                      <span>{t.hypeDepth > 0 ? `${fmtCompact(t.hypeDepth, 1)} HYPE in pools` : "no pool depth found"}</span>
                      <span>
                        {t.commentCount} {t.commentCount === 1 ? "post" : "posts"}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state === "loading" ? <Loom label={`Searching for “${q}”`} /> : null}
      {state === "error" ? (
        <div className="notice notice-error" role="alert">
          <p>Search failed. {error}</p>
        </div>
      ) : null}

      {users.length ? (
        <section>
          <h2 className="section-title">People</h2>
          <ul className="people">
            {users.map((p) => (
              <li key={p.id}>
                <Link to={`/app/u/${p.username}`} className="person">
                  <Avatar user={p} size={42} />
                  <span className="person-main">
                    <strong>{p.displayName}</strong>
                    <span>@{p.username}</span>
                    {p.bio ? <span className="person-bio">{p.bio}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {posts.length ? (
        <section>
          <h2 className="section-title">Posts</h2>
          <div className="feed">
            {posts.map((p) => (
              <PostCard
                key={p.feedId}
                post={p}
                onChange={(n) => setPosts((cur) => cur.map((x) => (x.id === n.id ? n : x)))}
                onRemove={(id) => setPosts((cur) => cur.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        </section>
      ) : null}

      {state === "ready" && !users.length && !posts.length && !rooms.length ? (
        <div className="empty">
          <p>
            <strong>Nothing matches “{q}”.</strong>
          </p>
          <p>Try a shorter word, a @username, a #tag or a $ticker.</p>
        </div>
      ) : null}
    </>
  );
}
