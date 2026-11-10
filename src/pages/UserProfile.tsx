import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AuthUser, DirectoryToken, PostItem, ReplyItem, api } from "../lib/api";
import { UserAvatar } from "../lib/avatars";
import { PostCard } from "../components/PostCard";
import { ConnectionsPanel } from "../components/ConnectionsPanel";
import { explorerAddressUrl } from "../config/chain";
import { shortAddr, timeAgo } from "../lib/format";

export function UserProfile({
  viewer,
  directory,
}: {
  viewer: AuthUser | null;
  directory: DirectoryToken[];
}): React.ReactElement {
  const { username = "" } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any | null>(null);
  const [pinnedPost, setPinnedPost] = useState<PostItem | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [tokenComments, setTokenComments] = useState<ReplyItem[]>([]);
  const [replies, setReplies] = useState<Array<ReplyItem & { postSnippet: string }>>([]);
  const [tab, setTab] = useState<"posts" | "token-comments" | "replies">("posts");
  const [loading, setLoading] = useState(true);
  const [connModal, setConnModal] = useState<"followers" | "following" | null>(
    null
  );

  const loadProfile = () => {
    setLoading(true);
    api
      .getUserProfile(username)
      .then((res) => {
        setProfile(res.profile);
        setPinnedPost(res.pinnedPost);
        setPosts(res.posts || []);
        setTokenComments(res.tokenComments || []);
        setReplies(res.replies || []);
      })
      .catch(() => {
        setProfile(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (username) loadProfile();
  }, [username]);

  const handleFollowToggle = async () => {
    if (!viewer) {
      navigate("/auth");
      return;
    }
    try {
      const res = await api.toggleFollow(username);
      setProfile((p: any) =>
        p
          ? {
              ...p,
              viewerFollowing: res.following,
              followerCount: res.followerCount,
            }
          : p
      );
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="content-card">
        <p className="muted-note">Loading operator profile…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="empty-card">
        <h2>Operator @{username} not found</h2>
        <Link to="/app" className="btn btn-primary btn-sm">
          Back to Feed
        </Link>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <section className="profile-hero-card">
        <div
          className="profile-banner-strip"
          style={
            profile.bannerUrl
              ? { backgroundImage: `url(${profile.bannerUrl})` }
              : undefined
          }
        />

        <div className="profile-hero-body">
          <div className="profile-avatar-row">
            <div className="profile-avatar-frame">
              <UserAvatar
                avatarId={profile.avatarId}
                avatarUrl={profile.avatarUrl}
                username={profile.username}
                size={76}
              />
            </div>

            <div className="profile-cta-group">
              {profile.isSelf ? (
                <Link to="/app/settings" className="btn btn-secondary btn-sm">
                  Edit Profile &amp; Wallet
                </Link>
              ) : (
                <>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      profile.viewerFollowing ? "btn-secondary" : "btn-primary"
                    }`}
                    onClick={handleFollowToggle}
                  >
                    {profile.viewerFollowing ? "Following" : "Follow"}
                  </button>
                  {viewer && (
                    <Link
                      to={`/app/messages?peer=${encodeURIComponent(profile.username)}`}
                      className="btn btn-ghost btn-sm"
                    >
                      Message
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="profile-identity">
            <h1 className="profile-display-name">{profile.displayName}</h1>
            <div className="profile-handle-line">
              <span className="profile-handle">@{profile.username}</span>
              {profile.walletAddress && (
                <a
                  href={explorerAddressUrl(profile.walletAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`badge ${
                    profile.walletVerified ? "badge-emerald" : "badge-subtle"
                  }`}
                >
                  {profile.walletVerified ? "✓ Verified " : "Linked "}
                  {shortAddr(profile.walletAddress, 6, 4)} ↗
                </a>
              )}
            </div>
          </div>

          {profile.bio && <p className="profile-bio">{profile.bio}</p>}

          <div className="profile-stats-bar">
            <button
              type="button"
              className="stat-link-btn"
              onClick={() => setConnModal("followers")}
            >
              <strong>{profile.followerCount}</strong> Followers
            </button>
            <button
              type="button"
              className="stat-link-btn"
              onClick={() => setConnModal("following")}
            >
              <strong>{profile.followingCount}</strong> Following
            </button>
            <span className="muted-note">
              Joined {new Date(profile.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </section>

      {pinnedPost && (
        <div className="pinned-section">
          <PostCard
            post={pinnedPost}
            viewer={viewer}
            directory={directory}
            isPinned
            onPinChanged={() => loadProfile()}
          />
        </div>
      )}

      <div className="tabs-row">
        <button
          type="button"
          className={`tab-btn ${tab === "posts" ? "is-active" : ""}`}
          onClick={() => setTab("posts")}
        >
          Threads ({posts.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "token-comments" ? "is-active" : ""}`}
          onClick={() => setTab("token-comments")}
        >
          Token Comments ({tokenComments.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === "replies" ? "is-active" : ""}`}
          onClick={() => setTab("replies")}
        >
          Replies ({replies.length})
        </button>
      </div>

      {tab === "posts" && (
        <div className="posts-stack">
          {posts.length === 0 ? (
            <div className="empty-card">
              <p className="muted-note">No threads published yet.</p>
            </div>
          ) : (
            posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                viewer={viewer}
                directory={directory}
                isPinned={profile.pinnedPostId === p.id}
                onDeleted={() => loadProfile()}
                onPinChanged={() => loadProfile()}
              />
            ))
          )}
        </div>
      )}

      {tab === "token-comments" && (
        <div className="content-card">
          {tokenComments.length === 0 ? (
            <p className="muted-note">No token timeline comments yet.</p>
          ) : (
            <div className="comments-tree-stack">
              {tokenComments.map((c) => (
                <Link
                  key={c.id}
                  to={`/app/token/${c.tokenAddress}`}
                  className="activity-item-card"
                >
                  <div className="activity-head">
                    <span className="badge badge-emerald">
                      ${c.tokenSymbol || shortAddr(c.tokenAddress, 5, 3)}
                    </span>
                    <span className="post-time">{timeAgo(c.createdAt)}</span>
                  </div>
                  <p>{c.content}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "replies" && (
        <div className="content-card">
          {replies.length === 0 ? (
            <p className="muted-note">No thread replies yet.</p>
          ) : (
            <div className="comments-tree-stack">
              {replies.map((r) => (
                <Link
                  key={r.id}
                  to={`/app/post/${r.postId}`}
                  className="activity-item-card"
                >
                  <div className="activity-head">
                    <span className="muted-note">
                      Reply to: "{r.postSnippet.slice(0, 60)}…"
                    </span>
                    <span className="post-time">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p>{r.content}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {connModal && (
        <ConnectionsPanel
          username={profile.username}
          initialTab={connModal}
          onClose={() => setConnModal(null)}
        />
      )}
    </div>
  );
}
