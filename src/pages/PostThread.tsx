import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AuthUser, DirectoryToken, PostItem, ReplyItem, api } from "../lib/api";
import { PostCard } from "../components/PostCard";
import { UserAvatar } from "../lib/avatars";
import { RichPostText } from "../components/TokenMention";
import { timeAgo } from "../lib/format";

export function PostThread({
  user,
  directory,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
}): React.ReactElement {
  const { postId = "" } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostItem | null>(null);
  const [replies, setReplies] = useState<ReplyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadThread = () => {
    setLoading(true);
    api
      .getPostThread(postId)
      .then((res) => {
        setPost(res.post);
        setReplies(res.replies || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (postId) loadThread();
  }, [postId]);

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !replyText.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.createReply(postId, {
        content: replyText.trim(),
        parentId,
      });
      setReplies((prev) => [...prev, res.reply]);
      setPost((p) => (p ? { ...p, replyCount: p.replyCount + 1 } : p));
      setReplyText("");
      setParentId(null);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReply = async (replyId: string) => {
    try {
      await api.deleteReply(replyId);
      setReplies((prev) => prev.filter((r) => r.id !== replyId));
      setPost((p) =>
        p ? { ...p, replyCount: Math.max(0, p.replyCount - 1) } : p
      );
    } catch {
      // ignore
    }
  };

  const topReplies = replies.filter((r) => !r.parentId);
  const childMap = new Map<string, ReplyItem[]>();
  for (const r of replies) {
    if (r.parentId) {
      const arr = childMap.get(r.parentId) || [];
      arr.push(r);
      childMap.set(r.parentId, arr);
    }
  }

  return (
    <div className="thread-page">
      <div className="page-sticky-head">
        <div className="page-head-top">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>
          <h1 className="page-title">Thread Conversation</h1>
        </div>
      </div>

      {loading ? (
        <div className="content-card">
          <p className="muted-note">Loading thread…</p>
        </div>
      ) : !post ? (
        <div className="empty-card">
          <h3>Thread not found</h3>
          <Link to="/app" className="btn btn-primary btn-sm">
            Return to Feed
          </Link>
        </div>
      ) : (
        <>
          <PostCard
            post={post}
            viewer={user}
            directory={directory}
            onDeleted={() => navigate("/app")}
          />

          <section className="content-card">
            <h2 className="section-title">Replies ({replies.length})</h2>

            {user ? (
              <form className="comment-composer-form" onSubmit={handleSubmitReply}>
                {parentId && (
                  <div className="replying-banner">
                    <span>Replying to nested comment</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setParentId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <textarea
                  className="composer-textarea"
                  rows={2}
                  maxLength={400}
                  placeholder="Write a reply…"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />
                <div className="comment-composer-foot">
                  <span className="muted-note">{400 - replyText.length} left</span>
                  <button
                    type="submit"
                    className="btn btn-primary btn-xs"
                    disabled={submitting || !replyText.trim()}
                  >
                    {submitting ? "Posting…" : "Post Reply"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted-note">
                <Link to="/auth">Sign in</Link> to reply to this thread.
              </p>
            )}

            <div className="comments-tree-stack">
              {topReplies.length === 0 ? (
                <p className="muted-note">No replies yet.</p>
              ) : (
                topReplies.map((r) => {
                  const nested = childMap.get(r.id) || [];
                  return (
                    <div key={r.id} className="comment-node">
                      <div className="comment-row">
                        <Link to={`/app/u/${r.username}`}>
                          <UserAvatar
                            avatarId={r.avatarId}
                            avatarUrl={r.avatarUrl}
                            username={r.username}
                            size={34}
                          />
                        </Link>
                        <div className="comment-body">
                          <div className="comment-meta">
                            <Link
                              to={`/app/u/${r.username}`}
                              className="font-semibold"
                            >
                              {r.displayName}
                            </Link>
                            <span className="muted-note">@{r.username}</span>
                            <span className="post-dot">·</span>
                            <span className="post-time">
                              {timeAgo(r.createdAt)}
                            </span>
                          </div>
                          <p className="comment-text">
                            <RichPostText content={r.content} directory={directory} />
                          </p>
                          <div className="comment-actions">
                            {user && (
                              <button
                                type="button"
                                className="post-action-btn"
                                onClick={() => setParentId(r.id)}
                              >
                                Reply
                              </button>
                            )}
                            {user && user.id === r.userId && (
                              <button
                                type="button"
                                className="post-action-btn is-danger"
                                onClick={() => handleDeleteReply(r.id)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {nested.length > 0 && (
                        <div className="comment-children">
                          {nested.map((child) => (
                            <div key={child.id} className="comment-row comment-child">
                              <Link to={`/app/u/${child.username}`}>
                                <UserAvatar
                                  avatarId={child.avatarId}
                                  avatarUrl={child.avatarUrl}
                                  username={child.username}
                                  size={28}
                                />
                              </Link>
                              <div className="comment-body">
                                <div className="comment-meta">
                                  <Link
                                    to={`/app/u/${child.username}`}
                                    className="font-semibold"
                                  >
                                    {child.displayName}
                                  </Link>
                                  <span className="muted-note">
                                    @{child.username}
                                  </span>
                                  <span className="post-dot">·</span>
                                  <span className="post-time">
                                    {timeAgo(child.createdAt)}
                                  </span>
                                </div>
                                <p className="comment-text">
                                  <RichPostText
                                    content={child.content}
                                    directory={directory}
                                  />
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
