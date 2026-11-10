import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AuthUser, DirectoryToken, PostItem, ReplyItem, api } from "../lib/api";
import { TokenMark, UserAvatar } from "../lib/avatars";
import { TokenChart } from "../components/TokenChart";
import { PostCard } from "../components/PostCard";
import { RichPostText } from "../components/TokenMention";
import { explorerTokenUrl } from "../config/chain";
import { SEEDED_TOKENS } from "../config/tokens";
import { fetchWalletTokenTier, WalletHoldingBadge } from "../lib/rpc";
import { fmtCompact, fmtPrice, shortAddr, timeAgo } from "../lib/format";

export function Token({
  user,
  directory,
  hypeUsd,
}: {
  user: AuthUser | null;
  directory: DirectoryToken[];
  hypeUsd: number;
}): React.ReactElement {
  const { address = "" } = useParams<{ address: string }>();
  const cleanAddr = address.toLowerCase();

  const dirToken = directory.find((t) => t.address.toLowerCase() === cleanAddr);
  const seeded = SEEDED_TOKENS.find((t) => t.address.toLowerCase() === cleanAddr);

  const [meta, setMeta] = useState<{
    symbol: string;
    name: string;
    decimals: number;
  }>({
    symbol: dirToken?.symbol || seeded?.symbol || "TOKEN",
    name: dirToken?.name || seeded?.name || "Elysium 99901 Token",
    decimals: dirToken?.decimals || seeded?.decimals || 18,
  });

  const [stats, setStats] = useState({
    ratingAvg: dirToken?.ratingAvg || 0,
    ratingCount: dirToken?.ratingCount || 0,
    bullishCount: dirToken?.bullishCount || 0,
    bearishCount: dirToken?.bearishCount || 0,
    bullishPct: dirToken?.bullishPct || 50,
  });
  const [viewerVote, setViewerVote] = useState<{
    rating: number | null;
    sentiment: "bullish" | "bearish" | null;
  }>({ rating: null, sentiment: null });

  const [comments, setComments] = useState<ReplyItem[]>([]);
  const [relatedPosts, setRelatedPosts] = useState<PostItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [holdingBadge, setHoldingBadge] = useState<WalletHoldingBadge | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSocial = () => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(cleanAddr)) return;
    api
      .getTokenSocial(cleanAddr)
      .then((res) => {
        setStats(res.stats);
        setViewerVote(res.viewerVote);
        setComments(res.comments || []);
        setRelatedPosts(res.relatedPosts || []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (dirToken) {
      setMeta({
        symbol: dirToken.symbol,
        name: dirToken.name,
        decimals: dirToken.decimals,
      });
    } else if (seeded) {
      setMeta({
        symbol: seeded.symbol,
        name: seeded.name,
        decimals: seeded.decimals,
      });
    } else if (/^0x[a-fA-F0-9]{40}$/.test(cleanAddr)) {
      fetch(`/api/token-meta/${cleanAddr}`)
        .then((r) => r.json())
        .then((d: any) => {
          if (d?.symbol) {
            setMeta({
              symbol: d.symbol,
              name: d.name || d.symbol,
              decimals: d.decimals || 18,
            });
          }
        })
        .catch(() => {});
    }
    loadSocial();
  }, [cleanAddr, dirToken?.symbol]);

  useEffect(() => {
    if (user?.walletAddress && /^0x[a-fA-F0-9]{40}$/.test(cleanAddr)) {
      fetchWalletTokenTier(cleanAddr, user.walletAddress, meta.decimals).then(
        setHoldingBadge
      );
    } else {
      setHoldingBadge(null);
    }
  }, [cleanAddr, user?.walletAddress, meta.decimals]);

  const handleVote = async (input: {
    rating?: number;
    sentiment?: "bullish" | "bearish";
  }) => {
    if (!user) return;
    try {
      const res = await api.voteToken(cleanAddr, input);
      setStats(res.stats);
      setViewerVote(res.viewerVote);
    } catch {
      // ignore
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await api.addTokenComment(cleanAddr, {
        content: commentText.trim(),
        parentId: replyParentId,
        tokenSymbol: meta.symbol,
      });
      setCommentText("");
      setReplyParentId(null);
      loadSocial();
    } catch {
      // ignore
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (id: string) => {
    try {
      await api.deleteTokenComment(id);
      loadSocial();
    } catch {
      // ignore
    }
  };

  const topLevelComments = comments.filter((c) => !c.parentId);
  const childrenByParent = new Map<string, ReplyItem[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = childrenByParent.get(c.parentId) || [];
      arr.push(c);
      childrenByParent.set(c.parentId, arr);
    }
  }

  return (
    <div className="token-page">
      {/* Token Header Card */}
      <section className="token-header-card">
        <div className="token-header-top">
          <div className="token-identity-row">
            <TokenMark address={cleanAddr} symbol={meta.symbol} size={52} />
            <div>
              <div className="token-title-line">
                <h1 className="token-sym-heading">${meta.symbol}</h1>
                <span className="token-full-name">{meta.name}</span>
                <span className="badge badge-subtle">
                  {dirToken?.launchpad || seeded?.launchpad || "Elysium 99901"}
                </span>
              </div>

              <div className="token-contract-line">
                <code className="contract-code">{cleanAddr}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    navigator.clipboard?.writeText(cleanAddr);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={explorerTokenUrl(cleanAddr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-ext-link"
                >
                  Elyscan ↗
                </a>
                {(dirToken?.launchpadUrl || seeded?.launchpadUrl) && (
                  <a
                    href={dirToken?.launchpadUrl || seeded?.launchpadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-ext-link"
                  >
                    Trade on {dirToken?.launchpad || seeded?.launchpad} ↗
                  </a>
                )}
              </div>
            </div>
          </div>

          {holdingBadge && (
            <div className="holder-tier-pill">
              <span
                className={`badge ${
                  holdingBadge.tier === "whale"
                    ? "badge-gold"
                    : holdingBadge.tier === "holder"
                    ? "badge-emerald"
                    : "badge-subtle"
                }`}
              >
                {holdingBadge.tier === "whale"
                  ? `🐋 Whale (${holdingBadge.pctOfSupply.toFixed(2)}% supply)`
                  : holdingBadge.tier === "holder"
                  ? `✓ Holder (${fmtCompact(holdingBadge.balanceFormatted, 2)} ${meta.symbol})`
                  : "Spectator (0 balance)"}
              </span>
            </div>
          )}
        </div>

        {/* Community Rating & Bullish/Bearish Bar */}
        <div className="token-community-bar">
          <div className="community-metric-box">
            <span className="stat-lbl">Community Rating</span>
            <div className="star-rating-row">
              <strong className="rating-big">
                ★ {stats.ratingCount > 0 ? stats.ratingAvg.toFixed(2) : "—"}
              </strong>
              <span className="muted-note">({stats.ratingCount} votes)</span>
              {user && (
                <div className="star-vote-row">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`star-btn ${
                        (viewerVote.rating || 0) >= star ? "is-lit" : ""
                      }`}
                      onClick={() => handleVote({ rating: star })}
                      aria-label={`Rate ${star} stars`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="community-metric-box">
            <span className="stat-lbl">
              Trench Sentiment ({stats.bullishPct}% Bullish)
            </span>
            <div className="sentiment-progress-track">
              <div
                className="sentiment-progress-fill"
                style={{ width: `${stats.bullishPct}%` }}
              />
            </div>
            <div className="sentiment-actions-row">
              <button
                type="button"
                className={`btn btn-xs ${
                  viewerVote.sentiment === "bullish"
                    ? "btn-primary"
                    : "btn-secondary"
                }`}
                disabled={!user}
                onClick={() => handleVote({ sentiment: "bullish" })}
              >
                ▲ Bullish ({stats.bullishCount})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${
                  viewerVote.sentiment === "bearish"
                    ? "btn-primary"
                    : "btn-ghost"
                }`}
                disabled={!user}
                onClick={() => handleVote({ sentiment: "bearish" })}
              >
                ▼ Bearish ({stats.bearishCount})
              </button>
            </div>
          </div>

          <div className="community-metric-box">
            <span className="stat-lbl">Pool Liquidity</span>
            <strong className="rating-big">
              {dirToken && dirToken.reserveWhype > 0
                ? `${fmtCompact(dirToken.reserveWhype, 2)} WHYPE`
                : "Seeded Launchpad"}
            </strong>
            <span className="muted-note">
              {dirToken?.priceHype
                ? `Spot: ${fmtPrice(dirToken.priceHype)} HYPE (${fmtPrice(
                    dirToken.priceHype * hypeUsd,
                    "$"
                  )})`
                : "Indexed on Elysium 99901"}
            </span>
          </div>
        </div>
      </section>

      {/* Native On-Chain Swap Chart */}
      <TokenChart
        tokenAddress={cleanAddr}
        tokenSymbol={meta.symbol}
        decimals={meta.decimals}
        hypeUsd={hypeUsd}
        fallbackPriceHype={dirToken?.priceHype || null}
      />

      {/* Token Discussion Room */}
      <section className="content-card">
        <h2 className="section-title">
          ${meta.symbol} Token Timeline ({comments.length})
        </h2>

        {user ? (
          <form className="comment-composer-form" onSubmit={handleAddComment}>
            {replyParentId && (
              <div className="replying-banner">
                <span>Replying to comment</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setReplyParentId(null)}
                >
                  Cancel
                </button>
              </div>
            )}
            <textarea
              className="composer-textarea"
              rows={2}
              maxLength={400}
              placeholder={`Post a comment in the $${meta.symbol} room…`}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
            />
            <div className="comment-composer-foot">
              <span className="muted-note">{400 - commentText.length} chars left</span>
              <button
                type="submit"
                className="btn btn-primary btn-xs"
                disabled={submittingComment || !commentText.trim()}
              >
                {submittingComment ? "Posting…" : "Post Comment"}
              </button>
            </div>
          </form>
        ) : (
          <p className="muted-note">
            <Link to="/auth">Sign in</Link> to post in the ${meta.symbol} timeline and vote on sentiment.
          </p>
        )}

        <div className="comments-tree-stack">
          {topLevelComments.length === 0 ? (
            <p className="muted-note">
              No comments in the ${meta.symbol} room yet. Start the discussion above!
            </p>
          ) : (
            topLevelComments.map((c) => {
              const replies = childrenByParent.get(c.id) || [];
              return (
                <div key={c.id} className="comment-node">
                  <div className="comment-row">
                    <Link to={`/app/u/${c.username}`}>
                      <UserAvatar
                        avatarId={c.avatarId}
                        avatarUrl={c.avatarUrl}
                        username={c.username}
                        size={34}
                      />
                    </Link>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <Link to={`/app/u/${c.username}`} className="font-semibold">
                          {c.displayName}
                        </Link>
                        <span className="muted-note">@{c.username}</span>
                        {c.walletVerified && (
                          <span className="badge badge-emerald">✓ 99901</span>
                        )}
                        <span className="post-dot">·</span>
                        <span className="post-time">{timeAgo(c.createdAt)}</span>
                      </div>
                      <p className="comment-text">
                        <RichPostText content={c.content} directory={directory} />
                      </p>
                      <div className="comment-actions">
                        {user && (
                          <button
                            type="button"
                            className="post-action-btn"
                            onClick={() => setReplyParentId(c.id)}
                          >
                            Reply
                          </button>
                        )}
                        {user && user.id === c.userId && (
                          <button
                            type="button"
                            className="post-action-btn is-danger"
                            onClick={() => handleDeleteComment(c.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {replies.length > 0 && (
                    <div className="comment-children">
                      {replies.map((child) => (
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
                              <span className="muted-note">@{child.username}</span>
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

      {/* Related Feed Posts */}
      <section className="content-card">
        <h2 className="section-title">
          Related Feed Posts Mentioning ${meta.symbol} ({relatedPosts.length})
        </h2>
        {relatedPosts.length === 0 ? (
          <p className="muted-note">
            No main-feed posts have tagged ${meta.symbol} yet. Tag{" "}
            <code>${meta.symbol}</code> in any post to appear here!
          </p>
        ) : (
          <div className="posts-stack">
            {relatedPosts.map((post) => (
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
    </div>
  );
}
