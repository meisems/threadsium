import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconBack } from "../components/icons";
import { NameLine, PostCard, useAuthGuard } from "../components/PostCard";
import { RichText } from "../components/RichText";
import { api, type Post, type Reply } from "../lib/api";
import { useApp } from "../state";

const MAX_REPLY = 400;

function ReplyItem({
  reply,
  nested,
  onAnswer,
  onChanged,
  onRemoved,
}: {
  reply: Reply;
  nested: boolean;
  onAnswer: (r: Reply) => void;
  onChanged: (r: Reply) => void;
  onRemoved: (id: string, removed: number) => void;
}): React.ReactElement {
  const { user, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reply.content);
  const [confirm, setConfirm] = useState(false);
  const mine = user?.id === reply.author.id;

  return (
    <li className={`reply${nested ? " reply-nested" : ""}`}>
      <div className="post-gutter">
        <Link to={`/app/u/${reply.author.username}`} tabIndex={-1} aria-label={`${reply.author.displayName}'s profile`}>
          <Avatar user={reply.author} size={nested ? 28 : 34} />
        </Link>
      </div>
      <div className="post-main">
        <NameLine user={reply.author} time={reply.createdAt} edited={!!reply.editedAt} />
        {editing ? (
          <div className="post-edit">
            <textarea className="field" rows={2} maxLength={MAX_REPLY} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit your reply" autoFocus />
            <div className="row-end">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={!draft.trim()}
                onClick={async () => {
                  try {
                    const r = await api.editReply(reply.id, draft);
                    onChanged({ ...reply, content: r.content, editedAt: r.editedAt });
                    setEditing(false);
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        ) : (
          <div className="post-body">
            <RichText text={reply.content} />
          </div>
        )}
        <div className="reply-actions">
          <button type="button" className="link-btn" onClick={() => onAnswer(reply)}>
            Reply
          </button>
          {mine && !editing ? (
            <>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setDraft(reply.content);
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="link-btn link-danger"
                onClick={async () => {
                  if (!confirm) return setConfirm(true);
                  try {
                    const r = await api.deleteReply(reply.id);
                    onRemoved(reply.id, r.removed);
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}
                onBlur={() => setConfirm(false)}
              >
                {confirm ? "Confirm delete" : "Delete"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function PostThread(): React.ReactElement {
  const { postId = "" } = useParams();
  const { user, toast } = useApp();
  const guard = useAuthGuard();
  const navigate = useNavigate();
  const location = useLocation();
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [answering, setAnswering] = useState<Reply | null>(null);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);

  const load = () => {
    setState("loading");
    api
      .post(postId)
      .then((r) => {
        setPost(r.post);
        setReplies(r.replies);
        setState("ready");
      })
      .catch((e) => {
        setError(e.message);
        setState(e.status === 404 ? "missing" : "error");
      });
  };
  useEffect(load, [postId, user?.id]);

  useEffect(() => {
    if (state === "ready" && location.hash === "#reply") box.current?.focus();
  }, [state, location.hash]);

  if (state === "loading") return <Loom label="Loading the post and its replies" />;
  if (state === "missing" || (state === "ready" && !post)) {
    return (
      <div className="empty">
        <p>
          <strong>This post is gone.</strong>
        </p>
        <p>It was deleted, or the link is wrong.</p>
        <Link className="btn btn-primary" to="/app">
          Back to Home
        </Link>
      </div>
    );
  }
  if (state === "error" || !post) {
    return (
      <div className="notice notice-error" role="alert">
        <p>The post could not be loaded. {error}</p>
        <button type="button" className="btn btn-ghost" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const send = async () => {
    const content = text.trim();
    if (!content || sending || !guard("reply")) return;
    setSending(true);
    try {
      const r = await api.reply(post.id, content, answering?.id ?? null);
      setReplies((cur) => [...cur, r.reply]);
      setPost({ ...post, replyCount: r.replyCount });
      setText("");
      setAnswering(null);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  const top = replies.filter((r) => !r.parentReplyId);
  const childrenOf = (id: string) => replies.filter((r) => r.parentReplyId === id);
  const answer = (r: Reply) => {
    setAnswering(r);
    setText((t) => (t.startsWith(`@${r.author.username}`) ? t : `@${r.author.username} ${t}`));
    box.current?.focus();
  };
  const changed = (r: Reply) => setReplies((cur) => cur.map((x) => (x.id === r.id ? r : x)));
  const removed = (id: string, n: number) => {
    setReplies((cur) => cur.filter((x) => x.id !== id && x.parentReplyId !== id));
    setPost((p) => (p ? { ...p, replyCount: Math.max(0, p.replyCount - n) } : p));
  };

  return (
    <>
      <div className="back-row">
        <button type="button" className="back-link" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/app"))}>
          <IconBack size={18} /> Back
        </button>
        <h1 className="back-title">Post</h1>
      </div>

      <PostCard post={post} onChange={setPost} onRemove={() => navigate("/app")} detail threadLine={replies.length > 0} />

      <div className="reply-box" id="reply">
        {user ? <Avatar user={user} size={34} /> : null}
        <div className="reply-box-main">
          {answering ? (
            <p className="reply-box-context">
              Answering @{answering.author.username}{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setAnswering(null);
                  setText("");
                }}
              >
                Cancel
              </button>
            </p>
          ) : null}
          <textarea
            ref={box}
            className="field"
            rows={2}
            maxLength={MAX_REPLY}
            value={text}
            placeholder={user ? `Reply to ${post.author.displayName}` : "Sign in to reply"}
            aria-label="Write a reply"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              if (!user) guard("reply");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
          <div className="row-end">
            {text.length > MAX_REPLY - 60 ? <span className="composer-count">{MAX_REPLY - text.length}</span> : null}
            <button type="button" className="btn btn-primary" disabled={sending || !text.trim()} onClick={send}>
              {sending ? "Sending…" : "Reply"}
            </button>
          </div>
        </div>
      </div>

      {top.length ? (
        <ul className="replies" aria-label="Replies">
          {top.map((r) => (
            <React.Fragment key={r.id}>
              <ReplyItem reply={r} nested={false} onAnswer={answer} onChanged={changed} onRemoved={removed} />
              {childrenOf(r.id).map((c) => (
                <ReplyItem key={c.id} reply={c} nested onAnswer={answer} onChanged={changed} onRemoved={removed} />
              ))}
            </React.Fragment>
          ))}
        </ul>
      ) : (
        <p className="feed-end">No replies yet. Start the thread.</p>
      )}
    </>
  );
}
