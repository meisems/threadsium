// Notifications, direct messages and saved posts.
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar } from "../components/Avatar";
import { Loom } from "../components/brand";
import { Feed } from "../components/Feed";
import { IconBack, IconBell, IconMail, IconReply, IconRepost, IconUser } from "../components/icons";
import { api, type Message, type Notice, type Person, type Thread } from "../lib/api";
import { ago, fullTime } from "../lib/format";
import { useApp } from "../state";

export function SignInWall({ what }: { what: string }): React.ReactElement {
  return (
    <div className="empty">
      <p>
        <strong>Sign in to see your {what}.</strong>
      </p>
      <Link className="btn btn-primary" to="/auth">
        Sign in or create an account
      </Link>
    </div>
  );
}

function noticeIcon(type: string): React.ReactElement {
  if (type === "follow") return <IconUser size={15} />;
  if (type === "repost" || type === "quote") return <IconRepost size={15} />;
  if (type === "reply" || type === "mention") return <IconReply size={15} />;
  return <IconBell size={15} />;
}

export function Notifications(): React.ReactElement {
  const { user, sessionReady, refreshCounts } = useApp();
  const [items, setItems] = useState<Notice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = () => {
    setState("loading");
    api
      .notifications()
      .then((r) => {
        setItems(r.notifications);
        setState("ready");
        if (r.notifications.some((n) => !n.readAt)) {
          api
            .markNotificationsRead()
            .then(refreshCounts)
            .catch(() => undefined);
        }
      })
      .catch(() => setState("error"));
  };
  useEffect(() => {
    if (user) load();
  }, [user?.id]);

  if (!sessionReady) return <Loom label="Checking your session" />;
  if (!user) return <SignInWall what="notifications" />;

  return (
    <>
      <header className="page-head">
        <h1>Notifications</h1>
        <p>Reactions, replies, reposts, mentions and new followers. Notifications are kept for 12 hours, then removed.</p>
      </header>
      {state === "loading" ? <Loom label="Loading notifications" /> : null}
      {state === "error" ? (
        <div className="notice notice-error" role="alert">
          <p>Notifications could not be loaded.</p>
          <button type="button" className="btn btn-ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {state === "ready" && !items.length ? (
        <div className="empty">
          <p>
            <strong>Nothing in the last 12 hours.</strong>
          </p>
          <p>When someone reacts, replies, reposts, mentions or follows you, it shows up here.</p>
        </div>
      ) : null}
      <ul className="notices">
        {items.map((n) => {
          // Older rows stored the actor inside the text ("@name liked…"); show only the action.
          const action = n.message.replace(/^@[A-Za-z0-9_]+\s+/, "");
          const body = (
            <>
              <span className="notice-avatar">
                {n.actor ? <Avatar user={n.actor} size={38} /> : <span className="avatar avatar-blank" />}
                <span className={`notice-kind notice-kind-${n.type}`}>{noticeIcon(n.type)}</span>
              </span>
              <span className="notice-main">
                <span>
                  <strong>{n.actor ? n.actor.displayName : "Someone"}</strong> {action}
                </span>
                <time dateTime={new Date(n.createdAt).toISOString()} title={fullTime(n.createdAt)}>
                  {ago(n.createdAt)}
                </time>
              </span>
            </>
          );
          return (
            <li key={n.id} className={n.readAt ? "" : "is-unread"}>
              {n.link ? (
                <Link to={n.link} className="notice-row">
                  {body}
                </Link>
              ) : (
                <div className="notice-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function Saved(): React.ReactElement {
  const { user, sessionReady } = useApp();
  if (!sessionReady) return <Loom label="Checking your session" />;
  if (!user) return <SignInWall what="saved posts" />;
  return (
    <>
      <header className="page-head">
        <h1>Saved</h1>
        <p>Posts you saved. Only you can see this list.</p>
      </header>
      <Feed
        feedKey={`saved:${user.id}`}
        load={(before) => api.saved(before)}
        loadingLabel="Loading saved posts"
        empty={
          <>
            <p>
              <strong>Nothing saved yet.</strong>
            </p>
            <p>Use the bookmark under a post to keep it here.</p>
          </>
        }
      />
    </>
  );
}

function Conversation({ username, onSent }: { username: string; onSent: () => void }): React.ReactElement {
  const { user, toast, refreshCounts } = useApp();
  const [peer, setPeer] = useState<Person | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  const count = useRef(0);

  const fetchNow = (quiet: boolean) => {
    if (!quiet) setState("loading");
    api
      .conversation(username)
      .then((r) => {
        setPeer(r.peer);
        setMessages(r.messages);
        setState("ready");
        if (r.messages.some((m) => m.recipientId === user?.id && !m.readAt)) {
          api
            .markConversationRead(username)
            .then(refreshCounts)
            .catch(() => undefined);
        }
      })
      .catch((e) => {
        if (!quiet) setState(e.status === 404 ? "missing" : "error");
      });
  };

  useEffect(() => {
    fetchNow(false);
    // New messages are picked up every 15 s while this tab is in front.
    const id = window.setInterval(() => document.visibilityState === "visible" && fetchNow(true), 15_000);
    return () => window.clearInterval(id);
  }, [username]);

  useEffect(() => {
    if (messages.length !== count.current) {
      count.current = messages.length;
      end.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const r = await api.sendMessage(username, content);
      setMessages((cur) => [...cur, r.message]);
      setText("");
      onSent();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  if (state === "loading") return <Loom label={`Opening your conversation with @${username}`} />;
  if (state === "missing") {
    return (
      <div className="empty">
        <p>
          <strong>There is no account called @{username}.</strong>
        </p>
      </div>
    );
  }
  if (state === "error" || !peer) {
    return (
      <div className="notice notice-error" role="alert">
        <p>The conversation could not be loaded.</p>
        <button type="button" className="btn btn-ghost" onClick={() => fetchNow(false)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="chat">
      <header className="chat-head">
        <Link to="/app/messages" className="icon-btn chat-back" aria-label="Back to all conversations">
          <IconBack size={20} />
        </Link>
        <Link to={`/app/u/${peer.username}`} className="person">
          <Avatar user={peer} size={36} />
          <span className="person-main">
            <strong>{peer.displayName}</strong>
            <span>@{peer.username}</span>
          </span>
        </Link>
      </header>
      <div className="chat-log" role="log" aria-label={`Messages with ${peer.displayName}`} tabIndex={0}>
        {messages.length === 0 ? <p className="feed-end">No messages yet. Say hello.</p> : null}
        {messages.map((m) => {
          const mine = m.senderId === user?.id;
          return (
            <div key={m.id} className={`bubble-row${mine ? " is-mine" : ""}`}>
              <div className="bubble">
                <p>{m.content}</p>
                <time dateTime={new Date(m.createdAt).toISOString()} title={fullTime(m.createdAt)}>
                  {ago(m.createdAt)}
                  {mine && m.readAt ? " · read" : ""}
                </time>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="field"
          rows={1}
          maxLength={1000}
          value={text}
          placeholder={`Message @${peer.username}`}
          aria-label="Write a message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

export function Messages(): React.ReactElement {
  const { username } = useParams();
  const { user, sessionReady } = useApp();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [to, setTo] = useState("");

  const load = () => {
    api
      .threads()
      .then((r) => {
        setThreads(r.threads);
        setState("ready");
      })
      .catch(() => setState("error"));
  };
  useEffect(() => {
    if (user) load();
  }, [user?.id, username]);

  if (!sessionReady) return <Loom label="Checking your session" />;
  if (!user) return <SignInWall what="messages" />;

  return (
    <div className={`messages${username ? " has-open" : ""}`}>
      <section className="threads" aria-label="Conversations">
        <header className="page-head">
          <h1>Messages</h1>
          <p>Private, one to one. Messages are stored on Threadsium's server and are not end-to-end encrypted.</p>
        </header>
        <form
          className="thread-new"
          onSubmit={(e) => {
            e.preventDefault();
            const name = to.trim().replace(/^@/, "");
            if (/^[A-Za-z0-9_]{3,20}$/.test(name)) {
              setTo("");
              navigate(`/app/messages/${name}`);
            }
          }}
        >
          <input className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Start a conversation: @username" aria-label="Username to message" maxLength={21} />
          <button type="submit" className="btn btn-ghost" disabled={!/^@?[A-Za-z0-9_]{3,20}$/.test(to.trim())}>
            Open
          </button>
        </form>
        {state === "loading" ? <Loom compact label="Loading conversations" /> : null}
        {state === "error" ? (
          <div className="notice notice-error" role="alert">
            <p>Conversations could not be loaded.</p>
            <button type="button" className="btn btn-ghost" onClick={load}>
              Try again
            </button>
          </div>
        ) : null}
        {state === "ready" && !threads.length ? (
          <div className="empty">
            <p>
              <strong>No conversations yet.</strong>
            </p>
            <p>Type a username above, or use Message on someone's profile.</p>
          </div>
        ) : null}
        <ul className="thread-list">
          {threads.map((t) => (
            <li key={t.peer.id}>
              <Link to={`/app/messages/${t.peer.username}`} className={`thread${username?.toLowerCase() === t.peer.username.toLowerCase() ? " is-active" : ""}`}>
                <Avatar user={t.peer} size={42} />
                <span className="thread-main">
                  <span className="thread-top">
                    <strong>{t.peer.displayName}</strong>
                    <time>{ago(t.last.createdAt)}</time>
                  </span>
                  <span className={`thread-last${t.unread ? " is-unread" : ""}`}>
                    {t.last.senderId === user.id ? "You: " : ""}
                    {t.last.content}
                  </span>
                </span>
                {t.unread ? <span className="badge-count">{t.unread}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="chat-pane" aria-label="Open conversation">
        {username ? (
          <Conversation key={username} username={username} onSent={load} />
        ) : (
          <div className="empty chat-empty">
            <IconMail size={30} />
            <p>Pick a conversation to read it here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
