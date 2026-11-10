import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { AuthUser, api } from "../lib/api";
import { UserAvatar } from "../lib/avatars";
import { timeAgo } from "../lib/format";

export function Notifications({
  user,
  onMarkedRead,
}: {
  user: AuthUser | null;
  onMarkedRead: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getNotifications()
      .then((res) => {
        setItems(res.items || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const handleMarkAllRead = async () => {
    try {
      await api.markNotificationsRead();
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      onMarkedRead();
    } catch {
      // ignore
    }
  };

  if (!user) {
    return (
      <div className="empty-card">
        <h2>Sign in to view notifications</h2>
        <Link to="/auth" className="btn btn-primary btn-sm">
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="notifications-page">
      <div className="page-sticky-head">
        <div className="page-head-top">
          <div>
            <h1 className="page-title">Notifications</h1>
            <span className="muted-note">
              Rolling 12-hour activity window (likes, reposts, quotes, replies, follows, DMs)
            </span>
          </div>
          {items.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={handleMarkAllRead}
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="content-card">
          <p className="muted-note">Loading notifications…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-card">
          <h3>No notifications in the last 12 hours</h3>
          <p className="muted-note">
            When operators like, rethread, quote, reply, follow, or DM you, alerts appear here.
          </p>
        </div>
      ) : (
        <div className="notifications-stack">
          {items.map((n) => {
            const targetHref = n.postId
              ? `/app/post/${n.postId}`
              : n.kind === "dm"
              ? `/app/messages?peer=${encodeURIComponent(n.actor.username)}`
              : `/app/u/${n.actor.username}`;

            return (
              <Link
                key={n.id}
                to={targetHref}
                className={`notification-row ${!n.readAt ? "is-unread" : ""}`}
              >
                <UserAvatar
                  avatarId={n.actor.avatarId}
                  avatarUrl={n.actor.avatarUrl}
                  username={n.actor.username}
                  size={38}
                />
                <div className="notification-body">
                  <div className="notification-top">
                    <span className="font-semibold">{n.actor.displayName}</span>
                    <span className="muted-note">@{n.actor.username}</span>
                    <span className="post-dot">·</span>
                    <span className="post-time">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="notification-msg">{n.message}</p>
                </div>
                {!n.readAt && <span className="unread-dot" aria-label="Unread" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
