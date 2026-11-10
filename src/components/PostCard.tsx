import React, { useState } from "react";
import { Link, useNavigate } from "react-router";
import { AuthUser, DirectoryToken, PostItem, api } from "../lib/api";
import { TokenMark, UserAvatar } from "../lib/avatars";
import { fullTimestamp, shortAddr, timeAgo } from "../lib/format";
import { RichPostText, resolveTickerAddress } from "./TokenMention";

export function PostCard({
  post: initialPost,
  viewer,
  directory = [],
  isPinned = false,
  onDeleted,
  onQuoteRequest,
  onPinChanged,
}: {
  post: PostItem;
  viewer: AuthUser | null;
  directory?: DirectoryToken[];
  isPinned?: boolean;
  onDeleted?: (postId: string) => void;
  onQuoteRequest?: (post: PostItem) => void;
  onPinChanged?: (pinnedId: string | null) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const [post, setPost] = useState<PostItem>(initialPost);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(initialPost.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const [shareToast, setShareToast] = useState(false);

  const isOwner = Boolean(viewer && viewer.id === post.userId);
  const resolvedTokenAddr =
    post.tokenAddress ||
    (post.tokenSymbol ? resolveTickerAddress(post.tokenSymbol, directory) : null);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!viewer) {
      navigate("/auth");
      return;
    }
    try {
      const res = await api.toggleLike(post.id);
      setPost((p) => ({
        ...p,
        viewerLiked: res.liked,
        likeCount: res.likeCount,
      }));
    } catch {
      // ignore
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!viewer) {
      navigate("/auth");
      return;
    }
    try {
      const res = await api.toggleRepost(post.id);
      setPost((p) => ({
        ...p,
        viewerReposted: res.reposted,
        repostCount: res.repostCount,
      }));
    } catch {
      // ignore
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/app/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `@${post.username} on Threadsium`,
          text: post.content.slice(0, 120),
          url,
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
      const res = await api.recordShare(post.id);
      setPost((p) => ({ ...p, shareCount: res.shareCount }));
    } catch {
      // ignore
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editDraft.trim()) return;
    setSavingEdit(true);
    try {
      const res = await api.editPost(post.id, editDraft.trim());
      setPost(res.post);
      setEditing(false);
    } catch {
      // ignore
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deletePost(post.id);
      onDeleted?.(post.id);
    } catch {
      // ignore
    }
  };

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await api.togglePin(post.id);
      onPinChanged?.(res.pinnedPostId);
    } catch {
      // ignore
    }
  };

  return (
    <article
      className={`post-card ${isPinned ? "post-card-pinned" : ""}`}
      onClick={() => {
        if (!editing) navigate(`/app/post/${post.id}`);
      }}
    >
      {isPinned && (
        <div className="post-repost-banner">
          <span>Pinned to profile</span>
        </div>
      )}

      {post.repostedBy && (
        <div className="post-repost-banner" onClick={(e) => e.stopPropagation()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M17 2L21 6L17 10M3 11V9C3 7.34315 4.34315 6 6 6H21M7 22L3 18L7 14M21 13V15C21 16.6569 19.6569 18 18 18H3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            Rethreaded by{" "}
            <Link to={`/app/u/${post.repostedBy.username}`}>
              @{post.repostedBy.username}
            </Link>
          </span>
        </div>
      )}

      <div className="post-card-main">
        <Link
          to={`/app/u/${post.username}`}
          onClick={(e) => e.stopPropagation()}
          className="post-avatar-link"
        >
          <UserAvatar
            avatarId={post.avatarId}
            avatarUrl={post.avatarUrl}
            username={post.username}
            size={42}
          />
        </Link>

        <div className="post-body-col">
          <header className="post-header">
            <div className="post-author-group" onClick={(e) => e.stopPropagation()}>
              <Link to={`/app/u/${post.username}`} className="post-author-name">
                {post.displayName}
              </Link>
              <Link to={`/app/u/${post.username}`} className="post-author-handle">
                @{post.username}
              </Link>
              {post.walletVerified && post.walletAddress && (
                <span
                  className="badge badge-emerald"
                  title={`Verified 99901 Wallet: ${post.walletAddress}`}
                >
                  ✓ {shortAddr(post.walletAddress, 4, 3)}
                </span>
              )}
              <span className="post-dot">·</span>
              <time
                dateTime={post.createdAt}
                title={fullTimestamp(post.createdAt)}
                className="post-time"
              >
                {timeAgo(post.createdAt)}
              </time>
              {post.editedAt && (
                <span className="post-edited-tag" title={`Edited ${fullTimestamp(post.editedAt)}`}>
                  (edited)
                </span>
              )}
            </div>

            {resolvedTokenAddr && (
              <Link
                to={`/app/token/${resolvedTokenAddr}`}
                className="post-token-chip"
                onClick={(e) => e.stopPropagation()}
              >
                <TokenMark
                  address={resolvedTokenAddr}
                  symbol={post.tokenSymbol || "TKN"}
                  size={18}
                />
                <span>${post.tokenSymbol || shortAddr(resolvedTokenAddr, 4, 3)}</span>
              </Link>
            )}
          </header>

          {editing ? (
            <form
              className="post-edit-form"
              onSubmit={handleSaveEdit}
              onClick={(e) => e.stopPropagation()}
            >
              <textarea
                className="composer-textarea"
                rows={3}
                maxLength={500}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
              />
              <div className="post-edit-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-xs"
                  disabled={savingEdit}
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          ) : (
            <div className="post-content">
              <RichPostText content={post.content} directory={directory} />
            </div>
          )}

          {post.imageUrl && (
            <div className="post-media-frame" onClick={(e) => e.stopPropagation()}>
              <img src={post.imageUrl} alt="Post attachment" loading="lazy" />
            </div>
          )}

          {post.quotedPost && (
            <div
              className="quoted-post-card"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/app/post/${post.quotedPost!.id}`);
              }}
            >
              <div className="quoted-post-head">
                <UserAvatar
                  avatarId={post.quotedPost.avatarId}
                  avatarUrl={post.quotedPost.avatarUrl}
                  username={post.quotedPost.username}
                  size={22}
                />
                <span className="font-semibold">{post.quotedPost.displayName}</span>
                <span className="muted-note">@{post.quotedPost.username}</span>
                <span className="post-dot">·</span>
                <span className="post-time">{timeAgo(post.quotedPost.createdAt)}</span>
              </div>
              <p className="quoted-post-text">{post.quotedPost.content}</p>
            </div>
          )}

          <footer className="post-actions-bar" onClick={(e) => e.stopPropagation()}>
            <Link
              to={`/app/post/${post.id}`}
              className="post-action-btn"
              aria-label={`Replies (${post.replyCount})`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{post.replyCount}</span>
            </Link>

            <button
              type="button"
              className={`post-action-btn ${post.viewerReposted ? "is-reposted" : ""}`}
              onClick={handleRepost}
              aria-label={`Repost (${post.repostCount})`}
              title="Repost to your followers"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M17 2L21 6L17 10M3 11V9C3 7.34315 4.34315 6 6 6H21M7 22L3 18L7 14M21 13V15C21 16.6569 19.6569 18 18 18H3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{post.repostCount}</span>
            </button>

            {onQuoteRequest && (
              <button
                type="button"
                className="post-action-btn"
                onClick={() => onQuoteRequest(post)}
                title="Quote this thread"
              >
                <span>Quote</span>
              </button>
            )}

            <button
              type="button"
              className={`post-action-btn ${post.viewerLiked ? "is-liked" : ""}`}
              onClick={handleLike}
              aria-label={`Like (${post.likeCount})`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={post.viewerLiked ? "currentColor" : "none"}>
                <path
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{post.likeCount}</span>
            </button>

            <button
              type="button"
              className="post-action-btn"
              onClick={handleShare}
              aria-label={`Share (${post.shareCount})`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{shareToast ? "Copied!" : post.shareCount || "Share"}</span>
            </button>

            {isOwner && (
              <div className="post-owner-controls">
                <button
                  type="button"
                  className="post-action-btn"
                  onClick={() => {
                    setEditDraft(post.content);
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
                {onPinChanged && (
                  <button
                    type="button"
                    className="post-action-btn"
                    onClick={handlePin}
                  >
                    {isPinned ? "Unpin" : "Pin"}
                  </button>
                )}
                <button
                  type="button"
                  className="post-action-btn is-danger"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            )}
          </footer>
        </div>
      </div>
    </article>
  );
}
