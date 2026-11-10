import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { AuthUser, DirectoryToken, PostItem, api } from "../lib/api";
import { PostComposer } from "../components/PostComposer";
import { PostCard } from "../components/PostCard";
import { TokenMark } from "../lib/avatars";
import { SpoolLoader } from "../components/brand";
import { fmtCompact, fmtPrice, shortAddr } from "../lib/format";
import { explorerTokenUrl } from "../config/chain";

export function Home({
  user,
  directory,
  hypeUsd,
  onDirectoryRefresh,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
  hypeUsd: number;
  onDirectoryRefresh: () => void;
}): React.ReactElement {
  const [tab, setTab] = useState<"feed" | "following" | "hall">("feed");
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotedPost, setQuotedPost] = useState<PostItem | null>(null);
  const [votingAddr, setVotingAddr] = useState<string | null>(null);

  const loadFeed = (activeTab: "feed" | "following") => {
    setLoading(true);
    setError(null);
    api
      .getPosts({ tab: activeTab, limit: 50 })
      .then((res) => {
        setPosts(res.items || []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load feed");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (tab === "feed" || tab === "following") {
      loadFeed(tab);
    }
  }, [tab]);

  const handleQuickVote = async (
    addr: string,
    payload: { rating?: number; sentiment?: "bullish" | "bearish" }
  ) => {
    if (!user) return;
    setVotingAddr(addr);
    try {
      await api.voteToken(addr, payload);
      onDirectoryRefresh();
    } catch {
      // ignore
    } finally {
      setVotingAddr(null);
    }
  };

  return (
    <div className="feed-page">
      <div className="page-sticky-head">
        <div className="page-head-top">
          <h1 className="page-title">Elysium 99901 Trench</h1>
          <span className="muted-note">Live threads, reposts &amp; launchpad rooms</span>
        </div>

        <div className="tabs-row" role="tablist" aria-label="Timeline tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "feed"}
            className={`tab-btn ${tab === "feed" ? "is-active" : ""}`}
            onClick={() => setTab("feed")}
          >
            All Threads
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "following"}
            className={`tab-btn ${tab === "following" ? "is-active" : ""}`}
            onClick={() => setTab("following")}
          >
            Following
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "hall"}
            className={`tab-btn ${tab === "hall" ? "is-active" : ""}`}
            onClick={() => setTab("hall")}
          >
            Hall of Fame ({directory.length})
          </button>
        </div>
      </div>

      {tab !== "hall" ? (
        <>
          <PostComposer
            user={user}
            directory={directory}
            quotedPost={quotedPost}
            onCancelQuote={() => setQuotedPost(null)}
            onCreated={(created) => {
              setQuotedPost(null);
              setPosts((prev) => [created, ...prev]);
            }}
          />

          {loading ? (
            <SpoolLoader
              stage={{
                label: "Synchronizing Elysium 99901 timeline",
                detail: "Loading threads, token mentions, and engagement state…",
                progress: 65,
              }}
              error={error}
              onRetry={() => loadFeed(tab === "following" ? "following" : "feed")}
            />
          ) : posts.length === 0 ? (
            <div className="empty-card">
              <h3>
                {tab === "following"
                  ? "No threads from followed accounts yet"
                  : "No threads in the trench yet"}
              </h3>
              <p className="muted-note">
                {tab === "following"
                  ? "Follow operators from the All Threads tab or Search page to populate your custom feed."
                  : "Be the first to post a thought or tag $KNTQ, $BOXA, or $KLEOS."}
              </p>
            </div>
          ) : (
            <div className="posts-stack">
              {posts.map((post) => (
                <PostCard
                  key={`${post.id}-${post.repostedBy?.repostedAt || "orig"}`}
                  post={post}
                  viewer={user}
                  directory={directory}
                  onDeleted={(id) =>
                    setPosts((prev) => prev.filter((p) => p.id !== id))
                  }
                  onQuoteRequest={(target) => {
                    setQuotedPost(target);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="hall-of-fame-stack">
          <div className="hall-banner">
            <h2>Elysium 99901 Hall of Fame</h2>
            <p className="muted-note">
              Flagship launchpad tokens (`BOXA`, `Kleos`, `ELYXA`, `ElysPump`, `Ronspad`, `Kinetiq`) plus live V3 &amp; V4 WHYPE pools ranked by liquidity and community sentiment.
            </p>
          </div>

          <div className="hall-grid">
            {directory.map((t) => (
              <div key={t.address} className="hall-token-card">
                <div className="hall-card-top">
                  <Link to={`/app/token/${t.address}`} className="hall-token-id">
                    <TokenMark address={t.address} symbol={t.symbol} size={44} />
                    <div>
                      <div className="hall-sym-row">
                        <span className="hall-sym">${t.symbol}</span>
                        <span className="badge badge-subtle">{t.launchpad}</span>
                      </div>
                      <span className="hall-name">{t.name}</span>
                    </div>
                  </Link>

                  <div className="hall-price-box">
                    <span className="hall-price">
                      {t.priceHype
                        ? `${fmtPrice(t.priceHype)} HYPE`
                        : "Seeded"}
                    </span>
                    {t.priceHype && (
                      <span className="hall-price-usd">
                        {fmtPrice(t.priceHype * hypeUsd, "$")}
                      </span>
                    )}
                  </div>
                </div>

                <p className="hall-tagline">{t.tagline}</p>

                <div className="hall-stats-row">
                  <div>
                    <span className="stat-lbl">Liquidity</span>
                    <span className="stat-val">
                      {t.reserveWhype > 0
                        ? `${fmtCompact(t.reserveWhype, 2)} WHYPE`
                        : "Launchpad"}
                    </span>
                  </div>
                  <div>
                    <span className="stat-lbl">Community Rating</span>
                    <span className="stat-val">
                      ★ {t.ratingCount > 0 ? `${t.ratingAvg.toFixed(1)} (${t.ratingCount})` : "Unrated"}
                    </span>
                  </div>
                  <div>
                    <span className="stat-lbl">Bullish Sentiment</span>
                    <span className="stat-val">{t.bullishPct}% Bullish</span>
                  </div>
                  <div>
                    <span className="stat-lbl">Comments</span>
                    <span className="stat-val">{t.commentCount}</span>
                  </div>
                </div>

                {user && (
                  <div className="hall-vote-strip">
                    <div className="star-vote-row" aria-label={`Rate ${t.symbol}`}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          className="star-btn"
                          disabled={votingAddr === t.address}
                          onClick={() => handleQuickVote(t.address, { rating: star })}
                          title={`Rate ${star} stars`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <div className="sentiment-vote-row">
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={votingAddr === t.address}
                        onClick={() =>
                          handleQuickVote(t.address, { sentiment: "bullish" })
                        }
                      >
                        ▲ Bullish ({t.bullishCount})
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={votingAddr === t.address}
                        onClick={() =>
                          handleQuickVote(t.address, { sentiment: "bearish" })
                        }
                      >
                        ▼ Bearish ({t.bearishCount})
                      </button>
                    </div>
                  </div>
                )}

                <div className="hall-card-foot">
                  <Link to={`/app/token/${t.address}`} className="btn btn-primary btn-xs">
                    Open Room &amp; Chart
                  </Link>
                  <a
                    href={t.launchpadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary btn-xs"
                  >
                    {t.launchpad} ↗
                  </a>
                  <a
                    href={explorerTokenUrl(t.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-xs"
                  >
                    {shortAddr(t.address, 5, 3)} ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
