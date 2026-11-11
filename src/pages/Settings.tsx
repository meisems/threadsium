import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Avatar, WEAVES, WeavePatch } from "../components/Avatar";
import { Loom } from "../components/brand";
import { IconVerified } from "../components/icons";
import { useSavedWallets, WalletChooser } from "../components/WalletChooser";
import { api, type IdentityProof, type Me } from "../lib/api";
import { walletConfirmation } from "../lib/siwe";
import { fmtBytes, fmtCount, shortAddr } from "../lib/format";
import { prepareImage } from "../lib/image";
import { useApp } from "../state";
import { SignInWall } from "./Inbox";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {note ? <p className="settings-note">{note}</p> : null}
      {children}
    </section>
  );
}

function ProfileForm({ user }: { user: Me }): React.ReactElement {
  const { setUser, toast } = useApp();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [weave, setWeave] = useState(user.avatarPreset ?? "");
  const [busy, setBusy] = useState<null | "save" | "avatar" | "banner">(null);
  const [error, setError] = useState("");
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const bannerInput = useRef<HTMLInputElement | null>(null);

  const dirty = displayName !== user.displayName || bio !== user.bio || weave !== (user.avatarPreset ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy("save");
    try {
      setUser(await api.updateProfile({ displayName, bio, avatarPreset: weave || null }));
      toast("Profile saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (f: File | undefined, kind: "avatar" | "banner") => {
    if (!f) return;
    setError("");
    setBusy(kind);
    try {
      const limits = await api.limits().catch(() => null);
      const blob = await prepareImage(f, kind === "avatar" ? 512 : 1600, limits?.media[kind] ?? 1024 * 1024);
      const r = await api.upload(blob, kind);
      setUser(r.user);
      toast(kind === "avatar" ? "Profile picture updated" : "Cover updated");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      if (avatarInput.current) avatarInput.current.value = "";
      if (bannerInput.current) bannerInput.current.value = "";
    }
  };

  const clear = async (kind: "avatar" | "banner") => {
    setError("");
    try {
      setUser(await api.updateProfile(kind === "avatar" ? { avatarUrl: null } : { bannerUrl: null }));
      toast(kind === "avatar" ? "Profile picture removed" : "Cover removed");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Section title="Profile" note="This is what other people see on your posts and your profile page.">
      <div className="settings-media">
        <div className="settings-cover">{user.bannerUrl ? <img src={user.bannerUrl} alt="Your cover" /> : <span>No cover image. Your profile shows a woven band instead.</span>}</div>
        <div className="settings-media-row">
          <Avatar user={user} size={72} />
          <div className="settings-media-actions">
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], "avatar")} />
            <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], "banner")} />
            <button type="button" className="btn btn-ghost btn-small" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
              {busy === "avatar" ? "Uploading…" : "Upload picture"}
            </button>
            {user.avatarUrl ? (
              <button type="button" className="btn btn-ghost btn-small" disabled={!!busy} onClick={() => void clear("avatar")}>
                Remove picture
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-small" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
              {busy === "banner" ? "Uploading…" : "Upload cover"}
            </button>
            {user.bannerUrl ? (
              <button type="button" className="btn btn-ghost btn-small" disabled={!!busy} onClick={() => void clear("banner")}>
                Remove cover
              </button>
            ) : null}
          </div>
        </div>
        <p className="hint">PNG, JPEG, WebP or GIF. Large photos are resized in your browser before they are sent.</p>
      </div>

      <form onSubmit={save}>
        <label className="label" htmlFor="set-name">
          Display name
        </label>
        <input id="set-name" className="field" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} required />

        <label className="label" htmlFor="set-bio">
          Bio
        </label>
        <textarea id="set-bio" className="field" rows={2} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} aria-describedby="set-bio-hint" />
        <p className="hint" id="set-bio-hint">
          {160 - bio.length} characters left
        </p>

        <fieldset className="weave-pick">
          <legend className="label">Weave colours</legend>
          <p className="hint">Used for your woven picture when no photo is uploaded, and for your cover band.</p>
          <div className="weave-options">
            {WEAVES.map((w) => (
              <label key={w.id} className={`weave-option${weave === w.id ? " is-on" : ""}`}>
                <input type="radio" name="weave" value={w.id} checked={weave === w.id} onChange={() => setWeave(w.id)} />
                <span className="avatar" style={{ width: 44, height: 44 }}>
                  <WeavePatch seed={user.username} preset={w.id} size={44} />
                </span>
                <span>{w.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!dirty || !!busy || !displayName.trim()}>
          {busy === "save" ? "Saving…" : "Save profile"}
        </button>
      </form>
    </Section>
  );
}

/** Asks the account's own wallet to sign a one-time confirmation, then hands the proof to `onProof`. */
function ConfirmWithWallet({ user, action, onProof }: { user: Me; action: string; onProof: (p: IdentityProof) => Promise<void> }): React.ReactElement {
  return <WalletChooser action={action} expect={user.walletAddress} onSigner={async (signer) => onProof(await walletConfirmation(signer))} />;
}

/** The encrypted copy of a wallet made at sign-up, if this browser holds one for this account. */
function BrowserCopy({ user }: { user: Me }): React.ReactElement | null {
  const { toast } = useApp();
  const [saved, refresh] = useSavedWallets();
  const [pw, setPw] = useState("");
  const [words, setWords] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const store = saved.find((k) => k.address === user.walletAddress?.toLowerCase());
  if (!store) return null;
  return (
    <div className="browser-copy">
      <h3>Saved in this browser</h3>
      <p className="hint">
        An encrypted copy of this wallet is stored in this browser, locked with the password you chose when you made it. It never leaves this browser.
      </p>
      {words ? (
        <>
          <ol className="phrase-grid" aria-label="Recovery phrase, in order">
            {words.map((w, i) => (
              <li key={i}>
                <span className="phrase-n">{i + 1}</span>
                <span className="mono">{w}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setWords(null)}>
            Hide the words
          </button>
        </>
      ) : (
        <form
          className="settings-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              const lw = await import("../lib/localWallet");
              setWords((await lw.decryptPhrase(store, pw)).split(" "));
              setPw("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label className="label" htmlFor="copy-pw">
            Show the recovery phrase
          </label>
          <div className="field-row">
            <input id="copy-pw" className="field" type="password" autoComplete="off" placeholder="Password for the saved copy" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button type="submit" className="btn btn-ghost" disabled={!pw}>
              Show
            </button>
          </div>
        </form>
      )}
      <div className="settings-row">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={async () => {
            if (!window.confirm("Remove the saved copy from this browser? You will need your 12 words to sign in here again.")) return;
            const lw = await import("../lib/localWallet");
            lw.forgetWallet(store.address);
            setWords(null);
            refresh();
            toast("Removed from this browser");
          }}
        >
          Remove from this browser
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function WalletForm({ user }: { user: Me }): React.ReactElement {
  const { setUser, toast } = useApp();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eth = (window as unknown as { ethereum?: Eth }).ethereum;

  const linkSigned = async () => {
    if (!eth) return;
    setError("");
    setBusy(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts?.[0];
      if (!addr) throw new Error("The wallet did not share an address.");
      const { message } = await api.walletChallenge();
      const signature = (await eth.request({ method: "personal_sign", params: [message, addr] })) as string;
      setUser(await api.updateProfile({ walletAddress: addr, walletSignature: signature }));
      toast("Wallet linked and verified");
    } catch (err) {
      const e = err as { code?: number; message?: string };
      setError(e.code === 4001 ? "You declined the request in your wallet. Nothing was changed." : e.message || "The wallet could not be linked.");
    } finally {
      setBusy(false);
    }
  };

  const linkPasted = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setUser(await api.updateProfile({ walletAddress: address.trim() }));
      setAddress("");
      toast("Address added, not verified");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Wallet"
      note={
        user.hasPassword
          ? "Optional. Linking shows your address on your profile. Signing a message proves you control it, adds the verified mark and lets you sign in with that wallet. Signing is free and sends no transaction."
          : "This account signs in with this wallet. You can switch to a different wallet by verifying it. To remove the wallet, add a password first."
      }
    >
      {user.walletAddress ? (
        <div className="settings-row">
          <span className="chip mono">
            {shortAddr(user.walletAddress, 8, 6)}
            <span className="chip-note">{user.walletVerified ? "verified" : "not verified"}</span>
            {user.walletVerified ? <IconVerified size={15} /> : null}
          </span>
          {user.hasPassword ? (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={busy}
            onClick={async () => {
              try {
                setUser(await api.updateProfile({ walletAddress: null }));
                toast("Wallet removed");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Remove wallet
          </button>
          ) : null}
        </div>
      ) : null}
      <BrowserCopy user={user} />

      <div className="settings-row">
        <button type="button" className="btn btn-ink" disabled={busy || !eth} onClick={linkSigned}>
          {busy ? "Waiting for your wallet…" : user.walletVerified ? "Verify a different wallet" : "Link and verify with your wallet"}
        </button>
        {!eth ? (
          <span className="hint">
            {user.hasPassword
              ? "No browser wallet was found on this device. You can still paste an address below."
              : "No browser wallet was found on this device. Open Threadsium in your wallet's browser to verify a different wallet."}
          </span>
        ) : null}
      </div>

      {user.hasPassword ? (
      <form className="settings-inline" onSubmit={linkPasted}>
        <label className="label" htmlFor="set-wallet">
          Or paste an address (shown as not verified)
        </label>
        <div className="field-row">
          <input id="set-wallet" className="field mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} maxLength={42} />
          <button type="submit" className="btn btn-ghost" disabled={busy || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())}>
            Add address
          </button>
        </div>
      </form>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Section>
  );
}

function PasswordForm({ user }: { user: Me }): React.ReactElement {
  const { setUser, toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user.hasPassword) {
    return (
      <Section
        title="Add a password"
        note="Optional. A password is a second way into this account, for devices where your wallet is not at hand. Adding one signs you out on every other device."
      >
        <label className="label" htmlFor="set-pw-first">
          New password
        </label>
        <input id="set-pw-first" className="field" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} />
        <p className="hint">At least 8 characters. Then confirm with your wallet:</p>
        {next.length >= 8 ? (
          <ConfirmWithWallet
            user={user}
            action="Confirm"
            onProof={async (proof) => {
              setError("");
              try {
                await api.changePassword(proof, next);
                setNext("");
                setUser((await api.me()) ?? user);
                toast("Password added");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </Section>
    );
  }
  return (
    <Section title="Password" note="Changing it signs you out on every other device.">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            await api.changePassword({ password: current }, next);
            setCurrent("");
            setNext("");
            toast("Password changed");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="label" htmlFor="set-pw-old">
          Current password
        </label>
        <input id="set-pw-old" className="field" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={128} />
        <label className="label" htmlFor="set-pw-new">
          New password
        </label>
        <input id="set-pw-new" className="field" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} aria-describedby="set-pw-hint" />
        <p className="hint" id="set-pw-hint">
          At least 8 characters.
        </p>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy || !current || next.length < 8}>
          {busy ? "Changing…" : "Change password"}
        </button>
      </form>
    </Section>
  );
}

function Insights(): React.ReactElement {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.insights>>["insights"] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .insights()
      .then((r) => setData(r.insights))
      .catch(() => setFailed(true));
  }, []);
  const rows: [string, number][] = data
    ? [
        ["Posts", data.posts],
        ["Reactions received", data.reactionsReceived],
        ["Replies received", data.repliesReceived],
        ["Reposts and quotes", data.repostsReceived],
        ["Shares", data.sharesReceived],
        ["Followers", data.followers],
        ["Following", data.following],
      ]
    : [];
  return (
    <Section title="Your numbers" note="Totals across everything you have posted. Counted on the server, updated when this page loads.">
      {failed ? <p className="form-error">Your numbers could not be loaded.</p> : null}
      {!data && !failed ? <Loom compact label="Counting" /> : null}
      {data ? (
        <dl className="stat-grid">
          {rows.map(([label, n]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{fmtCount(n)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Section>
  );
}

function StatusPanel(): React.ReactElement {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.status>> | null>(null);
  const [limits, setLimits] = useState<Awaited<ReturnType<typeof api.limits>>["media"] | null>(null);
  useEffect(() => {
    api.status().then(setStatus).catch(() => undefined);
    api
      .limits()
      .then((r) => setLimits(r.media))
      .catch(() => undefined);
  }, []);
  return (
    <Section title="Storage and limits" note="Threadsium runs on Cloudflare's free allowances, so storage is finite. These are the live figures for the whole site.">
      {!status ? <Loom compact label="Reading storage status" /> : null}
      {status ? (
        <dl className="stat-grid">
          <div>
            <dt>Accounts</dt>
            <dd>{fmtCount(status.counts.users)}</dd>
          </div>
          <div>
            <dt>Posts</dt>
            <dd>{fmtCount(status.counts.posts)}</dd>
          </div>
          <div>
            <dt>Images stored</dt>
            <dd>
              {status.counts.mediaObjects} ({fmtBytes(status.counts.mediaBytes)})
            </dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>{status.storage.relational}</dd>
          </div>
          <div>
            <dt>Image storage</dt>
            <dd>{status.storage.media}</dd>
          </div>
          {limits ? (
            <div>
              <dt>Image allowance per account</dt>
              <dd>{fmtBytes(limits.perAccount)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Section>
  );
}

function DeleteAccount({ user }: { user: Me }): React.ReactElement {
  const { setUser, toast } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async (proof: IdentityProof) => {
    setError("");
    setBusy(true);
    try {
      await api.deleteAccount(proof);
      setUser(null);
      toast("Your account was deleted");
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!user.hasPassword) {
    return (
      <Section title="Delete account" note="Removes your profile, posts, replies, reactions, follows, messages and uploaded images. This cannot be undone. Your wallet itself is not touched.">
        {!open ? (
          <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
            Delete @{user.username}
          </button>
        ) : (
          <>
            <p className="hint">Sign with your wallet to confirm.</p>
            <ConfirmWithWallet user={user} action="Delete forever" onProof={remove} />
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Keep my account
            </button>
          </>
        )}
      </Section>
    );
  }
  return (
    <Section title="Delete account" note="Removes your profile, posts, replies, reactions, follows, messages and uploaded images. This cannot be undone.">
      {!open ? (
        <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
          Delete @{user.username}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void remove({ password });
          }}
        >
          <label className="label" htmlFor="set-del">
            Enter your password to confirm
          </label>
          <input id="set-del" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="settings-row">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Keep my account
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy || !password}>
              {busy ? "Deleting…" : "Delete account forever"}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

export function Settings(): React.ReactElement {
  const { user, sessionReady, setUser, toast } = useApp();
  if (!sessionReady) return <Loom label="Checking your session" />;
  if (!user) return <SignInWall what="settings" />;
  return (
    <>
      <header className="page-head">
        <h1>Settings</h1>
        <p>Signed in as @{user.username}.</p>
      </header>
      <ProfileForm user={user} />
      <WalletForm user={user} />
      <Section title="Privacy">
        <label className="switch">
          <input
            type="checkbox"
            checked={user.showConnections}
            onChange={async (e) => {
              try {
                setUser(await api.updateProfile({ showConnections: e.target.checked }));
                toast(e.target.checked ? "Your follower lists are visible" : "Your follower lists are hidden");
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          />
          <span>
            <strong>Show who I follow and who follows me</strong>
            <span className="hint">When off, other people see the counts but not the lists.</span>
          </span>
        </label>
      </Section>
      <PasswordForm user={user} />
      <Insights />
      <StatusPanel />
      <DeleteAccount user={user} />
    </>
  );
}
