import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AuthUser, api } from "../lib/api";
import { UserAvatar } from "../lib/avatars";
import { timeAgo } from "../lib/format";

export function Messages({
  user,
}: {
  user: AuthUser | null;
}): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const activePeer = searchParams.get("peer") || "";

  const [threads, setThreads] = useState<any[]>([]);
  const [peerInfo, setPeerInfo] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = () => {
    if (!user) return;
    api
      .getMessageThreads()
      .then((res) => {
        setThreads(res.threads || []);
        if (!activePeer && res.threads.length > 0) {
          setSearchParams({ peer: res.threads[0].peer.username });
        }
      })
      .catch(() => {});
  };

  const loadConversation = (peerUsername: string) => {
    if (!user || !peerUsername) return;
    setError(null);
    api
      .getConversation(peerUsername)
      .then((res) => {
        setPeerInfo(res.peer);
        setMessages(res.messages || []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load conversation");
      });
  };

  useEffect(() => {
    loadThreads();
  }, [user?.id]);

  useEffect(() => {
    if (activePeer) {
      loadConversation(activePeer);
    }
  }, [activePeer, user?.id]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activePeer || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.sendMessage(activePeer, draft.trim());
      setMessages((prev) => [...prev, res.message]);
      setDraft("");
      loadThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <div className="empty-card">
        <h2>Sign in to use Direct Messages</h2>
        <p className="muted-note">
          Message any operator who follows you or whom you follow on Elysium 99901.
        </p>
        <Link to="/auth" className="btn btn-primary btn-sm">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="messages-page">
      <div className="page-sticky-head">
        <h1 className="page-title">Direct Messages</h1>
      </div>

      <div className="dm-split-grid">
        <aside className="dm-threads-col" aria-label="Message threads">
          {threads.length === 0 ? (
            <div className="dm-empty-note">
              <p className="muted-note">
                Follow an operator or visit their profile to start a conversation.
              </p>
            </div>
          ) : (
            threads.map((t) => {
              const isSelected =
                t.peer.username.toLowerCase() === activePeer.toLowerCase();
              return (
                <button
                  key={t.peer.id}
                  type="button"
                  className={`dm-peer-row ${isSelected ? "is-active" : ""}`}
                  onClick={() => setSearchParams({ peer: t.peer.username })}
                >
                  <UserAvatar
                    avatarId={t.peer.avatarId}
                    avatarUrl={t.peer.avatarUrl}
                    username={t.peer.username}
                    size={38}
                  />
                  <div className="dm-peer-meta">
                    <div className="dm-peer-top">
                      <span className="font-semibold">{t.peer.displayName}</span>
                      {t.unreadCount > 0 && (
                        <span className="nav-badge">{t.unreadCount}</span>
                      )}
                    </div>
                    <span className="muted-note">@{t.peer.username}</span>
                    {t.lastMessage && (
                      <p className="dm-last-snippet">
                        {t.lastMessage.content.slice(0, 44)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="dm-chat-col" aria-label="Active conversation">
          {!activePeer ? (
            <div className="empty-card">
              <p className="muted-note">Select a conversation on the left.</p>
            </div>
          ) : (
            <>
              {peerInfo && (
                <div className="dm-chat-header">
                  <Link to={`/app/u/${peerInfo.username}`} className="dm-chat-peer">
                    <UserAvatar
                      avatarId={peerInfo.avatarId}
                      avatarUrl={peerInfo.avatarUrl}
                      username={peerInfo.username}
                      size={34}
                    />
                    <div>
                      <span className="font-semibold">{peerInfo.displayName}</span>
                      <span className="muted-note"> @{peerInfo.username}</span>
                    </div>
                  </Link>
                </div>
              )}

              <div className="dm-messages-scroll">
                {messages.length === 0 ? (
                  <p className="muted-note">
                    No messages yet with @{activePeer}. Say hello below!
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.senderId === user.id;
                    return (
                      <div
                        key={m.id}
                        className={`dm-bubble-row ${mine ? "is-mine" : "is-peer"}`}
                      >
                        <div className="dm-bubble">
                          <p>{m.content}</p>
                          <span className="dm-bubble-time">
                            {timeAgo(m.createdAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && <div className="form-error-banner">{error}</div>}

              <form className="dm-input-bar" onSubmit={handleSend}>
                <input
                  type="text"
                  className="text-input"
                  maxLength={500}
                  placeholder={`Message @${activePeer}…`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={sending || !draft.trim()}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
