import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Post, PostPage } from "../lib/api";
import { postBus } from "../state";
import { Loom } from "./brand";
import { PostCard } from "./PostCard";

/**
 * A paged list of posts. Loads 20 at a time, keeps what it already has when a later page fails,
 * and stays in sync with posts created, edited or deleted elsewhere on the page.
 */
export function Feed({
  feedKey,
  load,
  empty,
  accepts,
  loadingLabel = "Loading posts",
}: {
  /** Changing this resets the list (a different tab, room or profile). */
  feedKey: string;
  load: (before: number | null, signal: AbortSignal) => Promise<PostPage>;
  empty: React.ReactNode;
  /** Whether a post just written on this page belongs at the top of this list. */
  accepts?: (p: Post) => boolean;
  loadingLabel?: string;
}): React.ReactElement {
  const [posts, setPosts] = useState<Post[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "more" | "error">("loading");
  const [error, setError] = useState<string>("");
  const sentinel = useRef<HTMLDivElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const acceptsRef = useRef(accepts);
  acceptsRef.current = accepts;

  const fetchPage = useCallback((before: number | null) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState(before ? "more" : "loading");
    setError("");
    loadRef
      .current(before, ctrl.signal)
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setPosts((cur) => {
          if (!before) return page.posts;
          const seen = new Set(cur.map((p) => p.feedId));
          return [...cur, ...page.posts.filter((p) => !seen.has(p.feedId))];
        });
        setNext(page.nextBefore);
        setState("ready");
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted) return;
        setError(e.message || "Posts could not be loaded.");
        setState("error");
      });
  }, []);

  useEffect(() => {
    setPosts([]);
    setNext(null);
    fetchPage(null);
    return () => abort.current?.abort();
  }, [feedKey, fetchPage]);

  useEffect(
    () =>
      postBus.on((e) => {
        if (e.type === "created") {
          if (acceptsRef.current?.(e.post)) setPosts((cur) => (cur.some((p) => p.feedId === e.post.feedId) ? cur : [e.post, ...cur]));
        } else if (e.type === "updated") {
          setPosts((cur) => cur.map((p) => (p.id === e.post.id ? { ...e.post, feedId: p.feedId, repostedBy: p.repostedBy, sortAt: p.sortAt } : p)));
        } else {
          setPosts((cur) => cur.filter((p) => p.id !== e.id));
        }
      }),
    [],
  );

  // Fetch the next page shortly before the reader reaches the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || state !== "ready" || !next) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) fetchPage(next);
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state, next, fetchPage]);

  const change = (p: Post) => setPosts((cur) => cur.map((x) => (x.id === p.id ? { ...p, feedId: x.feedId, repostedBy: x.repostedBy, sortAt: x.sortAt } : x)));
  const remove = (id: string) => setPosts((cur) => cur.filter((x) => x.id !== id));

  if (state === "loading") return <Loom label={loadingLabel} />;
  if (state === "error" && !posts.length) {
    return (
      <div className="notice notice-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-ghost" onClick={() => fetchPage(null)}>
          Try again
        </button>
      </div>
    );
  }
  if (!posts.length) return <div className="empty">{empty}</div>;

  return (
    <div className="feed">
      {posts.map((p) => (
        <PostCard key={p.feedId} post={p} onChange={change} onRemove={remove} />
      ))}
      {state === "more" ? <Loom compact label="Loading older posts" /> : null}
      {state === "error" ? (
        <div className="notice notice-error" role="alert">
          <p>Older posts could not be loaded. {error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => fetchPage(next)}>
            Try again
          </button>
        </div>
      ) : null}
      {state === "ready" && next ? (
        <div ref={sentinel} className="feed-more">
          <button type="button" className="btn btn-ghost" onClick={() => fetchPage(next)}>
            Show older posts
          </button>
        </div>
      ) : null}
      {state === "ready" && !next && posts.length > 5 ? <p className="feed-end">That is everything so far.</p> : null}
    </div>
  );
}
