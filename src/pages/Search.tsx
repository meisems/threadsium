import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthUser, DirectoryToken, PostItem, api } from "../lib/api";
import { TokenMark, UserAvatar } from "../lib/avatars";
import { PostCard } from "../components/PostCard";
import { fmtCompact, fmtPrice, shortAddr } from "../lib/format";

export function Search({
  user,
  directory,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
}): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialQ = searchParams.get("q") || "";
  const [query, setQuery] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [discussedTokens, setDiscussedTokens] = useState<
    Array<{ tokenAddress: string; tokenSymbol: string; mentionCount: number }>
  >([]);

  const runSearch = (q: string) => {
    setLoading(true);
    api
      .search(q)
      .then((res) => {
        setUsers(res.users || []);
        setPosts(res.posts || []);
        setDiscussedTokens(res.discussedTokens || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setQuery(q);
    runSearch(q);
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      navigate(`/app/token/${trimmed.toLowerCase()}`);
      return;
    }
    setSearchParams(trimmed ? { q: trimmed } : {});
  };

  const filteredDirectory = query.trim()
    ? directory.filter((t) => {
        const q = query.trim().toLowerCase().replace(/^\$/, "");
        return (
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q) ||
          t.launchpad.toLowerCase().includes(q)
        );
      })
    : directory;

  return (
    <div className="search-page">
      <div className="page-sticky-head">
        <h1 className="page-title">Explore &amp; Trench Search</h1>
        <form className="search-bar-form" onSubmit={handleSubmit}>
          <input
            type="search"
            className="text-input"
            placeholder="Search @username, $TICKER, #hashtag, or paste 0x token contract address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search query"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>
      </div>

      <div className="search-sections">
        {discussedTokens.length > 0 && (
          <section className="content-card">
            <h2 className="section-title">Most Discussed in Threads</h2>
            <div className="discussed-chips-row">
              {discussedTokens.map((dt) => (
                <Link
                  key={dt.tokenAddress}
                  to={`/app/token/${dt.tokenAddress}`}
                  className="discussed-chip"
                >
                  <TokenMark
                    address={dt.tokenAddress}
                    symbol={dt.tokenSymbol}
                    size={24}
                  />
                  <span className="font-semibold">${dt.tokenSymbol}</span>
                  <span className="badge badge-emerald">{dt.mentionCount} posts</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="content-card">
          <div className="section-head-row">
            <h2 className="section-title">
              Active Tokens on Elysium 99901 ({filteredDirectory.length})
            </h2>
            <span className="muted-note">Click any token to open its chart &amp; room</span>
          </div>

          <div className="token-directory-grid">
            {filteredDirectory.slice(0, 18).map((t) => (
              <Link
                key={t.address}
                to={`/app/token/${t.address}`}
                className="token-dir-card"
              >
                <TokenMark address={t.address} symbol={t.symbol} size={38} />
                <div className="token-dir-info">
                  <div className="token-dir-top">
                    <span className="font-semibold">${t.symbol}</span>
                    <span className="badge badge-subtle">{t.launchpad}</span>
                  </div>
                  <span className="token-dir-name">{t.name}</span>
                  <div className="token-dir-meta">
                    <span className="font-mono">{shortAddr(t.address, 5, 3)}</span>
                    <span>·</span>
                    <span>
                      {t.priceHype
                        ? `${fmtPrice(t.priceHype)} HYPE`
                        : `${fmtCompact(t.reserveWhype, 1)} WHYPE`}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {users.length > 0 && (
          <section className="content-card">
            <h2 className="section-title">Matching Operators ({users.length})</h2>
            <div className="user-list-stack">
              {users.map((u) => (
                <Link
                  key={u.id}
                  to={`/app/u/${u.username}`}
                  className="user-row-card"
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
                        <span className="badge badge-emerald">✓ 99901</span>
                      )}
                    </div>
                    <span className="user-row-handle">@{u.username}</span>
                    {u.bio && <p className="user-row-bio">{u.bio}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {query.trim() && (
          <section className="content-card">
            <h2 className="section-title">
              Matching Threads ({posts.length})
            </h2>
            {loading ? (
              <p className="muted-note">Searching threads…</p>
            ) : posts.length === 0 ? (
              <p className="muted-note">No threads matched "{query}".</p>
            ) : (
              <div className="posts-stack">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    viewer={user}
                    directory={directory}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
