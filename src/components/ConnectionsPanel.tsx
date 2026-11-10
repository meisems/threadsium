import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { UserAvatar } from "../lib/avatars";

export function ConnectionsPanel({
  username,
  initialTab = "followers",
  onClose,
}: {
  username: string;
  initialTab?: "followers" | "following";
  onClose: () => void;
}): React.ReactElement {
  const [tab, setTab] = useState<"followers" | "following">(initialTab);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getUserConnections(username)
      .then((res) => {
        if (!alive) return;
        setHidden(res.hidden);
        setFollowers(res.followers || []);
        setFollowing(res.following || []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [username]);

  const list = tab === "followers" ? followers : following;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Connections for @${username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">@{username} Connections</h3>
            <p className="modal-subtitle">Elysium 99901 social graph</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="tabs-row">
          <button
            type="button"
            className={`tab-btn ${tab === "followers" ? "is-active" : ""}`}
            onClick={() => setTab("followers")}
          >
            Followers ({followers.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "following" ? "is-active" : ""}`}
            onClick={() => setTab("following")}
          >
            Following ({following.length})
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <p className="muted-note">Loading connection graph…</p>
          ) : hidden ? (
            <div className="empty-card">
              <p>@{username} has made their connection list private.</p>
            </div>
          ) : list.length === 0 ? (
            <div className="empty-card">
              <p>No {tab} yet.</p>
            </div>
          ) : (
            <div className="user-list-stack">
              {list.map((u) => (
                <Link
                  key={u.id}
                  to={`/app/u/${u.username}`}
                  className="user-row-card"
                  onClick={onClose}
                >
                  <UserAvatar
                    avatarId={u.avatarId}
                    avatarUrl={u.avatarUrl}
                    username={u.username}
                    size={40}
                  />
                  <div className="user-row-info">
                    <div className="user-row-title">
                      <span className="font-semibold">{u.displayName}</span>
                      {u.walletVerified && (
                        <span className="badge badge-emerald" title="Verified 99901 Wallet">
                          ✓ 99901
                        </span>
                      )}
                    </div>
                    <span className="user-row-handle">@{u.username}</span>
                    {u.bio && <p className="user-row-bio">{u.bio}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
