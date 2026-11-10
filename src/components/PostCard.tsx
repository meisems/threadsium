import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, REACTION_KINDS, type Post, type QuotedPost, type ReactionKind, type UserLite } from "../lib/api";
import { ago, fmtCount, fullTime } from "../lib/format";
import { postBus, useApp } from "../state";
import { Avatar, TokenMark } from "./Avatar";
import {
  IconBookmark,
  IconCopy,
  IconEdit,
  IconMore,
  IconPin,
  IconQuote,
  IconReply,
  IconRepost,
  IconShare,
  IconTrash,
  IconVerified,
  REACTION_LABEL,
  ReactionGlyph,
} from "./icons";
import { RichText } from "./RichText";

/** Returns a guard that sends signed-out people to the sign-in page and reports whether to continue. */
export function useAuthGuard(): (what: string) => boolean {
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  return (what: string) => {
    if (user) return true;
    toast(`Sign in to ${what}.`);
    navigate(`/auth?next=${encodeURIComponent(location.pathname + location.search)}`);
    return false;
  };
}

export function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

export function NameLine({ user, time, edited }: { user: UserLite; time?: number; edited?: boolean }): React.ReactElement {
  return (
    <span className="name-line">
      <Link to={`/app/u/${user.username}`} className="name-display">
        {user.displayName}
      </Link>
      {user.walletVerified ? (
        <span className="verified" title="Wallet ownership verified by signature">
          <IconVerified size={15} title="Verified wallet" />
        </span>
      ) : null}
      <span className="name-handle">@{user.username}</span>
      {time ? (
        <time className="name-time" dateTime={new Date(time).toISOString()} title={fullTime(time)}>
          {ago(time)}
        </time>
      ) : null}
      {edited ? <span className="name-time">edited</span> : null}
    </span>
  );
}

function RoomChip({ address }: { address: string }): React.ReactElement {
  const { tokenByAddress } = useApp();
  const tok = tokenByAddress(address);
  const symbol = tok?.symbol ?? `${address.slice(0, 6)}…`;
  return (
    <Link to={`/app/token/${address}`} className="room-chip" title={`Posted in the ${symbol} room`}>
      <TokenMark address={address} symbol={symbol} size={16} />
      <span>{tok ? `$${tok.symbol}` : symbol} room</span>
    </Link>
  );
}

export function QuotedCard({ post }: { post: QuotedPost | null }): React.ReactElement {
  if (!post) return <div className="quoted quoted-gone">The quoted post was deleted.</div>;
  return (
    <Link to={`/app/post/${post.id}`} className="quoted">
      <span className="quoted-head">
        <Avatar user={post.author} size={20} />
        <span className="name-display">{post.author.displayName}</span>
        <span className="name-handle">@{post.author.username}</span>
        <span className="name-time">{ago(post.createdAt)}</span>
      </span>
      {post.content ? <span className="quoted-body">{post.content}</span> : null}
      {post.imageUrl ? <img className="quoted-image" src={post.imageUrl} alt="" loading="lazy" decoding="async" /> : null}
    </Link>
  );
}

function ReactionControl({ post, onChange }: { post: Post; onChange: (p: Post) => void }): React.ReactElement {
  const { toast } = useApp();
  const guard = useAuthGuard();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  useDismiss(wrap, open, () => setOpen(false));

  const clearTimers = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    hoverTimer.current = pressTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const set = async (kind: ReactionKind | null) => {
    setOpen(false);
    if (!guard("react to posts") || busy) return;
    const before = post;
    const reactions = { ...post.reactions };
    if (post.viewer.reaction) reactions[post.viewer.reaction] = Math.max(0, (reactions[post.viewer.reaction] ?? 1) - 1);
    if (kind) reactions[kind] = (reactions[kind] ?? 0) + 1;
    const delta = (kind ? 1 : 0) - (post.viewer.reaction ? 1 : 0);
    onChange({ ...post, reactions, reactionCount: Math.max(0, post.reactionCount + delta), viewer: { ...post.viewer, reaction: kind } });
    setBusy(true);
    try {
      const r = await api.react(post.id, kind);
      onChange({ ...post, reactions: r.reactions, reactionCount: r.reactionCount, viewer: { ...post.viewer, reaction: r.reaction } });
    } catch (e) {
      onChange(before);
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const mine = post.viewer.reaction;
  return (
    <div
      className="react-wrap"
      ref={wrap}
      onMouseEnter={() => {
        if (!window.matchMedia("(hover: hover)").matches) return;
        clearTimers();
        hoverTimer.current = window.setTimeout(() => setOpen(true), 380);
      }}
      onMouseLeave={() => {
        clearTimers();
        hoverTimer.current = window.setTimeout(() => setOpen(false), 260);
      }}
    >
      <button
        type="button"
        className={`action action-react${mine ? ` is-on rx-on-${mine}` : ""}`}
        aria-pressed={!!mine}
        aria-label={mine ? `Remove your ${REACTION_LABEL[mine]} reaction. ${post.reactionCount} reactions` : `Like. ${post.reactionCount} reactions`}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          longPressed.current = false;
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            setOpen(true);
          }, 450);
        }}
        onPointerUp={() => pressTimer.current && window.clearTimeout(pressTimer.current)}
        onPointerCancel={() => pressTimer.current && window.clearTimeout(pressTimer.current)}
        onContextMenu={(e) => {
          if (longPressed.current) e.preventDefault();
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          void set(mine ? null : "like");
        }}
      >
        {mine ? <ReactionGlyph kind={mine} size={20} /> : <span className="react-idle" aria-hidden="true" />}
        <span className="action-count">{post.reactionCount > 0 ? fmtCount(post.reactionCount) : ""}</span>
      </button>
      <button
        type="button"
        className="react-more"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Choose a reaction"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.600" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="react-picker" role="group" aria-label="Reactions">
          {REACTION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`react-choice${mine === k ? " is-on" : ""}`}
              aria-label={REACTION_LABEL[k]}
              aria-pressed={mine === k}
              title={REACTION_LABEL[k]}
              onClick={() => void set(mine === k ? null : k)}
            >
              <ReactionGlyph kind={k} size={30} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReactionSummary({ post }: { post: Post }): React.ReactElement | null {
  const top = REACTION_KINDS.filter((k) => (post.reactions[k] ?? 0) > 0).sort((a, b) => (post.reactions[b] ?? 0) - (post.reactions[a] ?? 0));
  if (!top.length) return null;
  const label = top.map((k) => `${post.reactions[k]} ${REACTION_LABEL[k]}`).join(", ");
  return (
    <div className="react-summary" title={label} aria-label={label}>
      <span className="react-stack">
        {top.slice(0, 3).map((k) => (
          <ReactionGlyph key={k} kind={k} size={18} />
        ))}
      </span>
      <span>{top.map((k) => `${post.reactions[k]} ${REACTION_LABEL[k].toLowerCase()}`).join(" · ")}</span>
    </div>
  );
}

export function PostCard({
  post,
  onChange,
  onRemove,
  detail = false,
  threadLine = false,
  pinned = false,
}: {
  post: Post;
  onChange: (p: Post) => void;
  onRemove: (id: string) => void;
  /** The post's own page: larger text, no click-through. */
  detail?: boolean;
  /** Draw the thread down from the avatar to the replies below. */
  threadLine?: boolean;
  pinned?: boolean;
}): React.ReactElement {
  const { user, setUser, toast, compose } = useApp();
  const guard = useAuthGuard();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<null | "more" | "repost">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);
  const [saving, setSaving] = useState(false);
  const menus = useRef<HTMLDivElement | null>(null);
  useDismiss(menus, menu !== null, () => {
    setMenu(null);
    setConfirmDelete(false);
  });

  const isMine = user?.id === post.author.id;
  const url = `/app/post/${post.id}`;

  const openPost = (e: React.MouseEvent) => {
    if (detail || editing) return;
    if ((e.target as HTMLElement).closest("a, button, textarea, input, .react-picker, .menu")) return;
    if (window.getSelection()?.toString()) return;
    navigate(url);
  };

  const repost = async () => {
    setMenu(null);
    if (!guard("repost")) return;
    const before = post;
    onChange({
      ...post,
      repostCount: Math.max(0, post.repostCount + (post.viewer.reposted ? -1 : 1)),
      viewer: { ...post.viewer, reposted: !post.viewer.reposted },
    });
    try {
      const r = await api.repost(post.id);
      onChange({ ...post, repostCount: r.repostCount, viewer: { ...post.viewer, reposted: r.reposted } });
      toast(r.reposted ? "Reposted" : "Repost removed");
    } catch (e) {
      onChange(before);
      toast((e as Error).message, "error");
    }
  };

  const save = async () => {
    if (!guard("save posts")) return;
    const before = post;
    onChange({ ...post, viewer: { ...post.viewer, saved: !post.viewer.saved } });
    try {
      const r = await api.save(post.id);
      onChange({ ...post, viewer: { ...post.viewer, saved: r.saved } });
      toast(r.saved ? "Saved" : "Removed from saved");
    } catch (e) {
      onChange(before);
      toast((e as Error).message, "error");
    }
  };

  const share = async () => {
    const link = `${window.location.origin}${url}`;
    let shared = false;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${post.author.displayName} on Threadsium`, url: link });
        shared = true;
      } else {
        await navigator.clipboard.writeText(link);
        toast("Link copied");
        shared = true;
      }
    } catch {
      /* the share sheet was dismissed or the clipboard is blocked */
    }
    if (shared && user) {
      api
        .share(post.id)
        .then((r) => onChange({ ...post, shareCount: r.shareCount }))
        .catch(() => undefined);
    }
  };

  const remove = async () => {
    setMenu(null);
    setConfirmDelete(false);
    try {
      await api.deletePost(post.id);
      onRemove(post.id);
      postBus.emit({ type: "deleted", id: post.id });
      toast("Post deleted");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const pin = async () => {
    setMenu(null);
    try {
      const r = await api.pin(post.id);
      if (user) setUser({ ...user, pinnedPostId: r.pinnedPostId });
      toast(r.pinnedPostId ? "Pinned to your profile" : "Unpinned");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveEdit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await api.editPost(post.id, draft);
      onChange({ ...r.post, feedId: post.feedId, repostedBy: post.repostedBy, sortAt: post.sortAt });
      setEditing(false);
      toast("Post updated");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`post${detail ? " post-detail" : ""}`} onClick={openPost} aria-label={`Post by ${post.author.displayName}`}>
      {post.repostedBy ? (
        <div className="post-context">
          <IconRepost size={15} />
          <Link to={`/app/u/${post.repostedBy.username}`}>{post.repostedBy.id === user?.id ? "You" : post.repostedBy.displayName}</Link> reposted
        </div>
      ) : pinned ? (
        <div className="post-context">
          <IconPin size={15} /> Pinned
        </div>
      ) : null}
      <div className="post-row">
        <div className="post-gutter">
          <Link to={`/app/u/${post.author.username}`} aria-label={`${post.author.displayName}'s profile`} tabIndex={-1}>
            <Avatar user={post.author} size={detail ? 46 : 40} />
          </Link>
          {threadLine ? <span className="thread-line" aria-hidden="true" /> : null}
        </div>
        <div className="post-main">
          <header className="post-head">
            <NameLine user={post.author} time={post.createdAt} edited={!!post.editedAt} />
            <div className="post-menu" ref={menu === "more" ? menus : undefined}>
              <button
                type="button"
                className="icon-btn icon-btn-quiet"
                aria-label="More actions for this post"
                aria-haspopup="true"
                aria-expanded={menu === "more"}
                onClick={() => setMenu(menu === "more" ? null : "more")}
              >
                <IconMore size={18} />
              </button>
              {menu === "more" ? (
                <div className="menu menu-right" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      navigator.clipboard
                        .writeText(`${window.location.origin}${url}`)
                        .then(() => toast("Link copied"))
                        .catch(() => toast("Copy is blocked in this browser", "error"));
                    }}
                  >
                    <IconCopy size={17} /> Copy link
                  </button>
                  {isMine ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenu(null);
                          setDraft(post.content);
                          setEditing(true);
                        }}
                      >
                        <IconEdit size={17} /> Edit
                      </button>
                      <button type="button" role="menuitem" onClick={pin}>
                        <IconPin size={17} /> {user?.pinnedPostId === post.id ? "Unpin from profile" : "Pin to profile"}
                      </button>
                      <button type="button" role="menuitem" className="menu-danger" onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}>
                        <IconTrash size={17} /> {confirmDelete ? "Confirm delete" : "Delete"}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          {post.roomAddress ? <RoomChip address={post.roomAddress} /> : null}

          {editing ? (
            <div className="post-edit">
              <textarea
                className="field"
                value={draft}
                maxLength={500}
                rows={3}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Edit your post"
                autoFocus
              />
              <div className="row-end">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={saving || (!draft.trim() && !post.imageUrl)} onClick={saveEdit}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          ) : post.content ? (
            <div className="post-body">
              <RichText text={post.content} />
            </div>
          ) : null}

          {post.imageUrl ? (
            <a className="post-image" href={post.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the image in a new tab">
              <img src={post.imageUrl} alt="Image attached to the post" loading="lazy" decoding="async" />
            </a>
          ) : null}

          {post.isQuote ? <QuotedCard post={post.quoted} /> : null}

          <ReactionSummary post={post} />

          <footer className="post-actions" ref={menu === "repost" ? menus : undefined}>
            <ReactionControl post={post} onChange={onChange} />
            <Link className="action" to={`${url}#reply`} aria-label={`Reply. ${post.replyCount} replies`}>
              <IconReply size={19} />
              <span className="action-count">{post.replyCount > 0 ? fmtCount(post.replyCount) : ""}</span>
            </Link>
            <div className="action-wrap">
              <button
                type="button"
                className={`action${post.viewer.reposted ? " is-on action-repost-on" : ""}`}
                aria-haspopup="true"
                aria-expanded={menu === "repost"}
                aria-label={`Repost or quote. ${post.repostCount} reposts`}
                onClick={() => setMenu(menu === "repost" ? null : "repost")}
              >
                <IconRepost size={19} />
                <span className="action-count">{post.repostCount > 0 ? fmtCount(post.repostCount) : ""}</span>
              </button>
              {menu === "repost" ? (
                <div className="menu" role="menu">
                  <button type="button" role="menuitem" onClick={repost}>
                    <IconRepost size={17} /> {post.viewer.reposted ? "Undo repost" : "Repost"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      if (guard("quote posts")) compose({ quote: post });
                    }}
                  >
                    <IconQuote size={17} /> Quote
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`action${post.viewer.saved ? " is-on action-save-on" : ""}`}
              aria-pressed={post.viewer.saved}
              aria-label={post.viewer.saved ? "Remove from saved" : "Save"}
              onClick={save}
            >
              <IconBookmark size={19} filled={post.viewer.saved} />
            </button>
            <button type="button" className="action" aria-label={`Share. ${post.shareCount} shares`} onClick={share}>
              <IconShare size={19} />
              <span className="action-count">{post.shareCount > 0 ? fmtCount(post.shareCount) : ""}</span>
            </button>
          </footer>
        </div>
      </div>
    </article>
  );
}
