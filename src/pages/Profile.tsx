import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar, WeavePatch } from "../components/Avatar";
import { Loom } from "../components/brand";
import { Feed } from "../components/Feed";
import { IconClose, IconMail, IconVerified, IconWallet } from "../components/icons";
import { PostCard, useAuthGuard } from "../components/PostCard";
import { RichText } from "../components/RichText";
import { explorerAddress } from "../config/chain";
import { api, type Person, type Post, type ProfileResponse, type Reply } from "../lib/api";
import { ago, fmtCount, shortAddr } from "../lib/format";
import { useApp } from "../state";

type Tab = "posts" | "replies" | "media";

function Connections({ username, tab, onClose }: { username: string; tab: "followers" | "following"; onClose: () => void }): React.ReactElement {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [hidden, setHidden] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    setState("loading");
    api
      .connections(username, tab)
      .then((r) => {
        setHidden(r.hidden);
        setPeople(r.people);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [username, tab]);
  return (
    <section className="panel" aria-label={tab === "followers" ? "Followers" : "Following"}>
      <header className="panel-head">
        <h2>{tab === "followers" ? "Followers" : "Following"}</h2>
        <button type="button" className="icon-btn" aria-label="Close the list" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </header>
      {state === "loading" ? <Loom compact label="Loading the list" /> : null}
      {state === "error" ? <p className="form-error">The list could not be loaded.</p> : null}
      {state === "ready" && hidden ? <p className="panel-note">@{username} keeps this list private.</p> : null}
      {state === "ready" && !hidden && !people.length ? <p className="panel-note">Nobody here yet.</p> : null}
      <ul className="people">
        {people.map((p) => (
          <li key={p.id}>
            <Link to={`/app/u/${p.username}`} className="person" onClick={onClose}>
              <Avatar user={p} size={38} />
              <span className="person-main">
                <strong>{p.displayName}</strong>
                <span>@{p.username}</span>
                {p.bio ? <span className="person-bio">{p.bio}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Profile(): React.ReactElement {
  const { username = "" } = useParams();
  const { user, toast } = useApp();
  const guard = useAuthGuard();
  const navigate = useNavigate();
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [tab, setTab] = useState<Tab>("posts");
  const [list, setList] = useState<null | "followers" | "following">(null);
  const [replies, setReplies] = useState<Array<Reply & { postSnippet: string; postAuthor: string }> | null>(null);
  const [pinned, setPinned] = useState<Post | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setState("loading");
    api
      .profile(username)
      .then((r) => {
        setData(r);
        setPinned(r.pinnedPost);
        setState("ready");
      })
      .catch((e) => setState(e.status === 404 ? "missing" : "error"));
  };
  useEffect(() => {
    setTab("posts");
    setList(null);
    setReplies(null);
    load();
  }, [username, user?.id]);

  useEffect(() => {
    if (tab !== "replies" || replies) return;
    api
      .profileReplies(username)
      .then((r) => setReplies(r.replies))
      .catch(() => setReplies([]));
  }, [tab, username]);

  if (state === "loading") return <Loom label={`Loading @${username}`} />;
  if (state === "missing") {
    return (
      <div className="empty">
        <p>
          <strong>There is no account called @{username}.</strong>
        </p>
        <p>Check the spelling, or search for the person.</p>
        <Link className="btn btn-primary" to="/app/search">
          Search
        </Link>
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <div className="notice notice-error" role="alert">
        <p>This profile could not be loaded.</p>
        <button type="button" className="btn btn-ghost" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const { profile: p, counts, viewer } = data;

  const follow = async () => {
    if (!guard("follow people") || busy) return;
    setBusy(true);
    try {
      const r = await api.follow(p.username);
      setData({ ...data, counts: { ...counts, followers: r.followers }, viewer: { ...viewer, following: r.following } });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="profile">
        <div className="cover">
          {p.bannerUrl ? (
            <img src={p.bannerUrl} alt="" />
          ) : (
            <div className="cover-weave" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => (
                <WeavePatch key={i} seed={`${p.username}-${i}`} preset={p.avatarPreset} size={96} />
              ))}
            </div>
          )}
        </div>
        <div className="profile-body">
          <div className="profile-top">
            <Avatar user={p} size={104} className="profile-avatar" />
            <div className="profile-actions">
              {viewer.isSelf ? (
                <Link className="btn btn-ghost" to="/app/settings">
                  Edit profile
                </Link>
              ) : p.isSystem ? null : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => guard("send messages") && navigate(`/app/messages/${p.username}`)}>
                    <IconMail size={18} /> Message
                  </button>
                  <button type="button" className={`btn ${viewer.following ? "btn-ghost" : "btn-ink"}`} aria-pressed={viewer.following} disabled={busy} onClick={follow}>
                    {viewer.following ? "Following" : viewer.followsYou ? "Follow back" : "Follow"}
                  </button>
                </>
              )}
            </div>
          </div>

          <h1 className="profile-name">
            {p.displayName}
            {p.walletVerified ? (
              <span className="verified" title="Wallet ownership verified by signature">
                <IconVerified size={20} title="Verified wallet" />
              </span>
            ) : null}
          </h1>
          <p className="profile-handle">
            @{p.username}
            {viewer.followsYou && !viewer.isSelf ? <span className="tag">Follows you</span> : null}
            {p.isSystem ? <span className="tag">System account</span> : null}
          </p>
          {p.bio ? (
            <p className="profile-bio">
              <RichText text={p.bio} />
            </p>
          ) : null}

          <div className="profile-facts">
            {p.walletAddress ? (
              <a href={explorerAddress(p.walletAddress)} target="_blank" rel="noopener noreferrer" className="chip mono" title={p.walletAddress}>
                <IconWallet size={15} /> {shortAddr(p.walletAddress)}
                <span className="chip-note">{p.walletVerified ? "verified" : "not verified"}</span>
              </a>
            ) : null}
            <span>Joined {new Date(p.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          </div>

          <div className="profile-counts">
            <span>
              <strong>{fmtCount(counts.posts)}</strong> {counts.posts === 1 ? "post" : "posts"}
            </span>
            <button type="button" className="link-btn" onClick={() => setList(list === "followers" ? null : "followers")} aria-expanded={list === "followers"}>
              <strong>{fmtCount(counts.followers)}</strong> {counts.followers === 1 ? "follower" : "followers"}
            </button>
            <button type="button" className="link-btn" onClick={() => setList(list === "following" ? null : "following")} aria-expanded={list === "following"}>
              <strong>{fmtCount(counts.following)}</strong> following
            </button>
          </div>
        </div>
      </div>

      {list ? <Connections username={p.username} tab={list} onClose={() => setList(null)} /> : null}

      <div className="tabs" role="tablist" aria-label="Profile sections">
        {(["posts", "replies", "media"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
            {t === "posts" ? "Posts" : t === "replies" ? "Replies" : "Media"}
          </button>
        ))}
      </div>

      {tab === "posts" ? (
        <>
          {pinned ? <PostCard post={pinned} onChange={setPinned} onRemove={() => setPinned(null)} pinned /> : null}
          <Feed
            feedKey={`author:${p.username}:${user?.id ?? "anon"}`}
            load={(before, signal) => api.posts({ author: p.username, before }, signal)}
            accepts={(post) => post.author.id === p.id}
            empty={
              <p>
                <strong>{viewer.isSelf ? "You have not posted yet." : `@${p.username} has not posted yet.`}</strong>
              </p>
            }
          />
        </>
      ) : null}

      {tab === "media" ? (
        <Feed
          feedKey={`media:${p.username}`}
          load={(before, signal) => api.posts({ author: p.username, media: true, before }, signal)}
          empty={
            <p>
              <strong>No posts with images yet.</strong>
            </p>
          }
        />
      ) : null}

      {tab === "replies" ? (
        replies === null ? (
          <Loom compact label="Loading replies" />
        ) : replies.length === 0 ? (
          <div className="empty">
            <p>
              <strong>No replies yet.</strong>
            </p>
          </div>
        ) : (
          <ul className="reply-log">
            {replies.map((r) => (
              <li key={r.id}>
                <Link to={`/app/post/${r.postId}`} className="reply-log-item">
                  <span className="reply-log-context">
                    Replying to @{r.postAuthor}
                    {r.postSnippet ? `: “${r.postSnippet}${r.postSnippet.length >= 120 ? "…" : ""}”` : ""}
                  </span>
                  <span className="reply-log-body">{r.content}</span>
                  <span className="name-time">{ago(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
