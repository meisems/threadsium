import React, { useState } from "react";
import { AuthUser, DirectoryToken, PostItem, api } from "../lib/api";
import { UserAvatar } from "../lib/avatars";
import { extractTextTokens } from "../lib/format";
import { resolveTickerAddress } from "./TokenMention";
import { SEEDED_TOKENS } from "../config/tokens";

export function PostComposer({
  user,
  directory = [],
  defaultTokenAddress = null,
  defaultTokenSymbol = null,
  quotedPost = null,
  onCreated,
  onCancelQuote,
  placeholder = "Drop alpha on Elysium 99901… Tag $KNTQ, $BOXA, $KLEOS, a 0x token address, or #elysium",
}: {
  user: AuthUser | null;
  directory?: DirectoryToken[];
  defaultTokenAddress?: string | null;
  defaultTokenSymbol?: string | null;
  quotedPost?: PostItem | null;
  onCreated: (post: PostItem) => void;
  onCancelQuote?: () => void;
  placeholder?: string;
}): React.ReactElement {
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = extractTextTokens(content);
  const remaining = 500 - content.length;

  const insertTag = (tag: string) => {
    setContent((prev) => {
      const sep = prev.length > 0 && !prev.endsWith(" ") ? " " : "";
      return `${prev}${sep}${tag} `;
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await api.uploadMedia(file, "post");
      setImageUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const trimmed = content.trim();
    if (!trimmed) {
      setError("Write a thought before posting.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      let tokenAddress = defaultTokenAddress;
      let tokenSymbol = defaultTokenSymbol;
      if (!tokenAddress && detected.addresses.length > 0) {
        tokenAddress = detected.addresses[0];
      }
      if (!tokenSymbol && detected.tickers.length > 0) {
        tokenSymbol = detected.tickers[0];
        if (!tokenAddress) {
          tokenAddress = resolveTickerAddress(tokenSymbol, directory);
        }
      }

      const res = await api.createPost({
        content: trimmed,
        tokenAddress,
        tokenSymbol,
        imageUrl,
        quotedPostId: quotedPost ? quotedPost.id : null,
      });
      setContent("");
      setImageUrl(null);
      onCreated(res.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish thread");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="composer-card composer-guest">
        <div>
          <h3 className="composer-guest-title">Join the Elysium 99901 Trench</h3>
          <p className="muted-note">
            Sign in or register an operator handle to publish threads, attach charts, rate tokens, and DM builders.
          </p>
        </div>
        <a href="/auth" className="btn btn-primary btn-sm">
          Sign In / Register
        </a>
      </div>
    );
  }

  return (
    <form className="composer-card" onSubmit={handleSubmit}>
      <div className="composer-top">
        <UserAvatar
          avatarId={user.avatarId}
          avatarUrl={user.avatarUrl}
          username={user.username}
          size={42}
        />
        <div className="composer-input-col">
          <textarea
            className="composer-textarea"
            rows={3}
            maxLength={500}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={placeholder}
            aria-label="Compose a new thread"
          />

          {quotedPost && (
            <div className="quoted-preview-box">
              <div className="quoted-preview-header">
                <span>
                  Quoting <strong>@{quotedPost.username}</strong>
                </span>
                {onCancelQuote && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={onCancelQuote}
                  >
                    Remove quote
                  </button>
                )}
              </div>
              <p className="quoted-preview-body">{quotedPost.content}</p>
            </div>
          )}

          {imageUrl && (
            <div className="composer-image-preview">
              <img src={imageUrl} alt="Upload preview" />
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => setImageUrl(null)}
              >
                Remove image
              </button>
            </div>
          )}

          {(detected.tickers.length > 0 ||
            detected.addresses.length > 0 ||
            detected.hashtags.length > 0) && (
            <div className="composer-detected-row">
              <span className="detected-label">Detected:</span>
              {detected.tickers.map((t) => (
                <span key={t} className="badge badge-emerald">
                  ${t}
                </span>
              ))}
              {detected.addresses.map((a) => (
                <span key={a} className="badge badge-gold">
                  {a.slice(0, 6)}…{a.slice(-4)}
                </span>
              ))}
              {detected.hashtags.map((h) => (
                <span key={h} className="badge badge-subtle">
                  #{h}
                </span>
              ))}
            </div>
          )}

          <div className="composer-quick-tags" aria-label="Quick ticker tags">
            {SEEDED_TOKENS.slice(0, 6).map((t) => (
              <button
                key={t.symbol}
                type="button"
                className="quick-tag-chip"
                onClick={() => insertTag(`$${t.symbol}`)}
              >
                +${t.symbol}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="form-error-banner">{error}</div>}

      <div className="composer-footer">
        <div className="composer-tools">
          <label className="btn btn-ghost btn-sm" title="Attach image (PNG/JPEG/WebP/GIF ≤ 4MB)">
            {uploading ? "Uploading…" : "Attach Image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleImageSelect}
              disabled={uploading || submitting}
              style={{ display: "none" }}
            />
          </label>
          <span
            className={`char-counter ${
              remaining < 40 ? "is-warn" : ""
            }`}
          >
            {remaining}
          </span>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={submitting || uploading || !content.trim()}
        >
          {submitting ? "Publishing…" : quotedPost ? "Post Quote" : "Post Thread"}
        </button>
      </div>
    </form>
  );
}
