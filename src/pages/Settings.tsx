import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { AuthUser, api } from "../lib/api";
import { AvatarPicker } from "../components/AvatarPicker";
import { shortAddr } from "../lib/format";

export function Settings({
  user,
  onUserUpdated,
  onLogout,
}: {
  user: AuthUser | null;
  onUserUpdated: (u: AuthUser) => void;
  onLogout: () => void;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarId, setAvatarId] = useState(user?.avatarId || "kinepip-samurai");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl || null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(user?.bannerUrl || null);
  const [walletAddress, setWalletAddress] = useState(user?.walletAddress || "");
  const [showConnections, setShowConnections] = useState(
    user ? user.showConnections : true
  );

  const [saving, setSaving] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [systemStatus, setSystemStatus] = useState<any | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio);
      setAvatarId(user.avatarId);
      setAvatarUrl(user.avatarUrl);
      setBannerUrl(user.bannerUrl);
      setWalletAddress(user.walletAddress || "");
      setShowConnections(user.showConnections);
      api.getAnalytics().then(setAnalytics).catch(() => {});
    }
    api.getStatus().then(setSystemStatus).catch(() => {});
  }, [user?.id]);

  if (!user) {
    return (
      <div className="empty-card">
        <h2>Sign in to manage account settings</h2>
        <Link to="/auth" className="btn btn-primary btn-sm">
          Sign In
        </Link>
      </div>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await api.updateProfile({
        displayName,
        bio,
        avatarId,
        avatarUrl,
        bannerUrl,
        walletAddress: walletAddress.trim() || null,
        showConnections,
      });
      onUserUpdated(res.user);
      setStatusMsg("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBanner(true);
    setError(null);
    try {
      const res = await api.uploadMedia(file, "banner");
      setBannerUrl(res.url);
      setStatusMsg("Banner uploaded. Click Save Profile to apply.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Banner upload failed");
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleConnectAndVerifyWallet = async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setError(
        "No injected EVM wallet detected. You can still paste a 0x address manually above."
      );
      return;
    }
    setVerifyingWallet(true);
    setError(null);
    setStatusMsg(null);
    try {
      const accounts: string[] = await eth.request({
        method: "eth_requestAccounts",
      });
      const account = accounts?.[0];
      if (!account) throw new Error("No wallet account selected");
      const message = `Threadsium Wallet Link\nUser: @${user.username}\nWallet: ${account.toLowerCase()}\nChain: 99901\nTimestamp: ${new Date().toISOString()}`;
      const signature: string = await eth.request({
        method: "personal_sign",
        params: [message, account],
      });
      const res = await api.updateProfile({
        walletAddress: account.toLowerCase(),
        walletMessage: message,
        walletSignature: signature,
      });
      setWalletAddress(account.toLowerCase());
      onUserUpdated(res.user);
      setStatusMsg("Wallet verified via EIP-191 signature!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet verification failed");
    } finally {
      setVerifyingWallet(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="page-sticky-head">
        <div className="page-head-top">
          <h1 className="page-title">Operator Settings &amp; Analytics</h1>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onLogout}
          >
            Sign Out
          </button>
        </div>
      </div>

      {analytics && (
        <section className="content-card">
          <h2 className="section-title">Personal Trench Analytics</h2>
          <div className="analytics-grid">
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.postCount}</span>
              <span className="analytic-lbl">Threads</span>
            </div>
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.likesReceived}</span>
              <span className="analytic-lbl">Likes Received</span>
            </div>
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.repostsReceived}</span>
              <span className="analytic-lbl">Rethreads</span>
            </div>
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.sharesReceived}</span>
              <span className="analytic-lbl">Shares</span>
            </div>
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.tokenCommentsMade}</span>
              <span className="analytic-lbl">Token Comments</span>
            </div>
            <div className="analytic-tile">
              <span className="analytic-val">{analytics.followerCount}</span>
              <span className="analytic-lbl">Followers</span>
            </div>
          </div>
        </section>
      )}

      <form className="content-card settings-form" onSubmit={handleSaveProfile}>
        <h2 className="section-title">Profile &amp; Identity</h2>

        <label className="form-field">
          <span className="field-label">Display Name</span>
          <input
            type="text"
            className="text-input"
            maxLength={40}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        <label className="form-field">
          <span className="field-label">Bio (up to 240 chars)</span>
          <textarea
            className="composer-textarea"
            rows={3}
            maxLength={240}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </label>

        <div className="form-field">
          <span className="field-label">Avatar Preset or Custom Image</span>
          <AvatarPicker
            selectedId={avatarId}
            customUrl={avatarUrl}
            onSelectPreset={(id) => {
              setAvatarId(id);
              setAvatarUrl(null);
            }}
            onUploadedCustom={(url) => setAvatarUrl(url)}
          />
        </div>

        <div className="form-field">
          <span className="field-label">Profile Banner (PNG/JPEG/WebP ≤ 4MB)</span>
          <div className="banner-upload-row">
            <label className="btn btn-secondary btn-sm">
              {uploadingBanner ? "Uploading…" : "Upload Banner"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleBannerUpload}
                style={{ display: "none" }}
              />
            </label>
            {bannerUrl && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setBannerUrl(null)}
              >
                Clear Banner
              </button>
            )}
          </div>
        </div>

        <div className="form-field">
          <span className="field-label">
            Elysium 99901 EVM Wallet Address (for Whale / Holder badges)
          </span>
          <div className="wallet-input-row">
            <input
              type="text"
              className="text-input font-mono"
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={verifyingWallet}
              onClick={handleConnectAndVerifyWallet}
            >
              {verifyingWallet ? "Signing…" : "EIP-191 Sign & Verify"}
            </button>
          </div>
          {user.walletVerified && user.walletAddress && (
            <span className="badge badge-emerald">
              ✓ Cryptographically verified: {shortAddr(user.walletAddress, 6, 4)}
            </span>
          )}
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showConnections}
            onChange={(e) => setShowConnections(e.target.checked)}
          />
          <span>
            Allow other operators to view my Followers &amp; Following lists
          </span>
        </label>

        {statusMsg && <div className="form-success-banner">{statusMsg}</div>}
        {error && <div className="form-error-banner">{error}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Profile Changes"}
        </button>
      </form>

      {systemStatus?.storage && (
        <section className="content-card">
          <h2 className="section-title">Storage &amp; Free-Tier Quota Status</h2>
          <p className="muted-note">
            Backend: <strong>{systemStatus.storage.backend}</strong> · Notification Retention:{" "}
            <strong>{systemStatus.storage.notificationRetentionHours}h</strong>
          </p>
          <div className="quota-grid">
            <div className="quota-item">
              <span className="stat-lbl">Stored Media Volume</span>
              <span className="stat-val">
                {(systemStatus.storage.mediaBytes / (1024 * 1024)).toFixed(2)} MB (
                {systemStatus.storage.mediaCount} objects)
              </span>
            </div>
            <div className="quota-item">
              <span className="stat-lbl">Upload Caps</span>
              <span className="stat-val">
                Post ≤ {systemStatus.storage.quotas.maxPostImageMb}MB · Avatar ≤{" "}
                {systemStatus.storage.quotas.maxAvatarMb}MB
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
