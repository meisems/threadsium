// Threadsium Premium (1M THREADSIUM) and Premium Max (10M): higher limits, an editable badge, and for Max
// a picture badge, a tinted name, 4x image storage and a spot in "Who to follow".
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Avatar } from "../components/Avatar";
import { BADGE_GLYPH_LABELS, PremiumMark, badgeLabel } from "../components/Badge";
import { Loom } from "../components/brand";
import { IconCheck, IconExternal, IconImage, IconVerified } from "../components/icons";
import { explorerAddress } from "../config/chain";
import {
  BADGE_COLORS,
  BADGE_GLYPHS,
  BASIC_LIMITS,
  DEFAULT_BADGE,
  MAX_LIMITS,
  PREMIUM,
  PREMIUM_LIMITS,
  TIER_LABEL,
  cleanEmoji,
  type Badge,
  type BadgeColor,
} from "../config/premium";
import { api, type Me, type PremiumStatus } from "../lib/api";
import { shortAddr } from "../lib/format";
import { prepareImage } from "../lib/image";
import { useApp } from "../state";
import { PayCard } from "./PremiumPay";

const fmt = (n: number) => n.toLocaleString("en-US");
const MIN = fmt(PREMIUM.minTokens);
const MAX_MIN = fmt(PREMIUM.maxMinTokens);
const SYM = PREMIUM.symbol;
const QUICK_EMOJI = ["🔥", "💎", "🚀", "👑", "⚡", "🌙", "🐋", "🦄", "🍀", "🎯", "🧵", "🪐", "🐸", "🌊", "☄️", "🫡"];
const MAX_MARK: Badge = { icon: "crown", color: "gold" };

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Step({ done, n, title, children }: { done: boolean; n: number; title: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <li className={`premium-step${done ? " is-done" : ""}`}>
      <span className="premium-step-dot" aria-hidden="true">
        {done ? <IconCheck size={14} /> : n}
      </span>
      <div>
        <strong>{title}</strong>
        {children ? <div className="premium-step-body">{children}</div> : null}
      </div>
    </li>
  );
}

function StatusCard({ user, status, onStatus }: { user: Me; status: PremiumStatus | null; onStatus: (s: PremiumStatus) => void }): React.ReactElement {
  const { setUser, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = status?.me;
  const tokenLive = !!status?.tokenAddress;
  const balance = me?.balance != null ? Number(me.balance) : null;
  // The meter runs to the Premium Max line, with a tick at the Premium line.
  const pct = balance != null ? Math.min(100, (balance / PREMIUM.maxMinTokens) * 100) : 0;
  const premiumTick = (PREMIUM.minTokens / PREMIUM.maxMinTokens) * 100;
  const isMax = user.tier === "max";
  const holds = !!me && me.heldTier !== "basic";

  const check = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.refreshPremium();
      setUser(r.user);
      onStatus(r.status);
      toast(r.user.premium ? `${TIER_LABEL[r.user.tier]} is active` : `Balance read: below ${MIN} ${SYM}`);
    } catch (e) {
      setError((e as Error).message);
      api.premium().then(onStatus).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`premium-card premium-status${user.premium ? " is-active" : ""}${isMax ? " is-max" : ""}`} aria-labelledby="premium-status-h">
      <div className="premium-status-head">
        <h2 id="premium-status-h">{user.premium ? `${TIER_LABEL[user.tier]} is active` : "Your tier: Basic"}</h2>
        {user.premium && user.premiumUntil ? (
          <span className={`tag tag-premium${isMax ? " tag-max" : ""}`}>Valid until {when(user.premiumUntil)}</span>
        ) : null}
      </div>

      {!tokenLive && status ? (
        <p className="premium-notice">
          The {SYM} contract is not live on Elysium yet, so balances cannot be checked. Link and verify your wallet now and check back when the
          token launches.
        </p>
      ) : null}

      <ol className="premium-steps">
        <Step n={1} done={!!user.walletAddress && user.walletVerified} title="Link and verify a wallet">
          {user.walletAddress ? (
            <span className="chip mono">
              {shortAddr(user.walletAddress, 8, 6)}
              <span className="chip-note">{user.walletVerified ? "verified" : "not verified"}</span>
              {user.walletVerified ? <IconVerified size={14} /> : null}
            </span>
          ) : null}
          {!user.walletVerified ? (
            <p className="hint">
              Premium only counts a wallet you proved you control. <Link to="/app/settings">Sign with your wallet in Settings</Link>. It is free and
              sends no transaction.
            </p>
          ) : null}
        </Step>
        <Step n={2} done={holds} title={`Hold ${MIN} ${SYM} for Premium, ${MAX_MIN} for Premium Max`}>
          <div className="premium-meter-wrap">
            <div className="premium-meter" role="meter" aria-valuemin={0} aria-valuemax={PREMIUM.maxMinTokens} aria-valuenow={balance ?? 0} aria-label={`${SYM} held`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="premium-tick" style={{ left: `${premiumTick}%` }} aria-hidden="true">
              <PremiumMark badge={DEFAULT_BADGE} size={14} />
              <small>1M</small>
            </span>
            <span className="premium-tick is-end" aria-hidden="true">
              <PremiumMark badge={MAX_MARK} size={14} />
              <small>10M</small>
            </span>
          </div>
          <p className="hint">
            {balance != null ? (
              <>
                {fmt(Math.floor(balance))} {SYM}
                {me?.checkedAt ? ` · read ${when(me.checkedAt)}` : ""}
                {!isMax && balance >= PREMIUM.minTokens ? ` · ${fmt(Math.ceil(PREMIUM.maxMinTokens - balance))} more for Premium Max` : ""}
              </>
            ) : (
              "Your balance has not been read yet."
            )}
          </p>
          {status?.tokenAddress ? (
            <a className="hint premium-contract" href={explorerAddress(status.tokenAddress)} target="_blank" rel="noopener noreferrer">
              Contract {shortAddr(status.tokenAddress, 8, 6)} <IconExternal size={13} />
            </a>
          ) : null}
        </Step>
        <Step n={3} done={holds} title="Check your balance">
          <button type="button" className="btn btn-premium" disabled={busy || !tokenLive || !user.walletVerified} onClick={check}>
            {busy ? "Reading the chain…" : user.premium ? "Re-check balance" : "Check my balance"}
          </button>
          <p className="hint">
            A read-only balanceOf call on chain 99901. Nothing is locked or moved. Holders are re-checked every {PREMIUM.recheckMs / 3600_000} hours;
            your tier follows your balance up and down.
          </p>
        </Step>
      </ol>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function BadgeEditor({ user }: { user: Me }): React.ReactElement {
  const { setUser, toast } = useApp();
  const saved: Badge = user.badgeChoice ?? DEFAULT_BADGE;
  const [icon, setIcon] = useState(saved.icon);
  const [color, setColor] = useState<BadgeColor>(saved.color);
  const [tint, setTint] = useState(!!saved.tintName);
  const [emoji, setEmoji] = useState(saved.icon.startsWith("e:") ? saved.icon.slice(2) : "");
  const [busy, setBusy] = useState<null | "save" | "upload">(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const locked = !user.premium;
  const isMax = user.tier === "max";
  const image = user.badgeChoice?.image ?? null;
  const draft: Badge = { icon, color, image, tintName: tint };
  const dirty = icon !== saved.icon || color !== saved.color || tint !== !!saved.tintName;
  const isEmoji = icon.startsWith("e:");
  const needsMax = (icon === "img" || tint) && !isMax;

  useEffect(() => {
    const s = user.badgeChoice ?? DEFAULT_BADGE;
    setIcon(s.icon);
    setColor(s.color);
    setTint(!!s.tintName);
  }, [user.badgeChoice?.icon, user.badgeChoice?.color, user.badgeChoice?.tintName, user.badgeChoice?.image]);

  const pickEmoji = (raw: string) => {
    setEmoji(raw);
    const e = cleanEmoji(raw);
    if (e) setIcon(`e:${e}`);
  };

  const save = async (badge: Badge | null) => {
    setBusy("save");
    setError("");
    try {
      setUser(await api.setBadge(badge));
      toast(badge ? "Badge updated" : "Badge reset to the blue check");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy("upload");
    setError("");
    try {
      const limits = await api.limits().catch(() => null);
      const blob = await prepareImage(f, 160, limits?.media.badge ?? 512 * 1024);
      const r = await api.upload(blob, "badge");
      setUser(r.user);
      toast("Badge picture set");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <section className={`premium-card premium-editor${locked ? " is-locked" : ""}`} aria-labelledby="premium-badge-h">
      <div className="premium-status-head">
        <h2 id="premium-badge-h">Your badge</h2>
        {locked ? <span className="tag">Premium only</span> : null}
      </div>
      <p className="settings-note">
        Premium shows a blue check after your name everywhere on Threadsium. Swap it for another shape or any emoji, in any colour. Premium Max can
        also use its own picture and colour its name. Try anything here; saving needs the tier.
      </p>

      <div className="premium-preview" aria-label="Preview">
        <Avatar user={user} size={44} />
        <div>
          <span className="name-line">
            <span className="name-display" style={tint ? { color: BADGE_COLORS[color] } : undefined}>
              {user.displayName}
            </span>
            <span className="verified is-premium">
              <PremiumMark badge={draft} size={17} />
            </span>
            <span className="name-handle">@{user.username}</span>
          </span>
          <span className="premium-preview-sub">
            {badgeLabel(icon)}
            {tint ? " · tinted name" : ""}
          </span>
        </div>
        <span className="premium-preview-big" aria-hidden="true">
          <PremiumMark badge={draft} size={56} />
        </span>
      </div>

      <fieldset className="premium-pick" disabled={!!busy}>
        <legend className="label">Shape</legend>
        <div className="premium-glyphs">
          {BADGE_GLYPHS.map((g) => (
            <button
              key={g}
              type="button"
              className={`premium-glyph${icon === g ? " is-on" : ""}`}
              aria-pressed={icon === g}
              title={BADGE_GLYPH_LABELS[g]}
              onClick={() => setIcon(g)}
            >
              <PremiumMark badge={{ icon: g, color }} size={26} />
              <span>{BADGE_GLYPH_LABELS[g]}</span>
            </button>
          ))}
        </div>

        <p className="label premium-sublabel">
          Your picture <span className="tag tag-premium tag-max">Premium Max</span>
        </p>
        <div className="premium-pic-row">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          {image ? (
            <button
              type="button"
              className={`premium-glyph premium-pic-pick${icon === "img" ? " is-on" : ""}`}
              aria-pressed={icon === "img"}
              disabled={!isMax}
              onClick={() => setIcon("img")}
            >
              <PremiumMark badge={{ icon: "img", color, image }} size={30} />
              <span>Use picture</span>
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-small" disabled={!isMax || !!busy} onClick={() => fileInput.current?.click()}>
            <IconImage size={16} /> {busy === "upload" ? "Uploading…" : image ? "Replace picture" : "Upload a picture"}
          </button>
          <span className="hint">
            {isMax
              ? "PNG, JPEG, WebP or an animated GIF. Shown as a small circle, ringed in your badge colour."
              : `Hold ${MAX_MIN} ${SYM} to upload your own picture.`}
          </span>
        </div>

        <p className="label premium-sublabel">Or an emoji</p>
        <div className="premium-emojis">
          {QUICK_EMOJI.map((e) => (
            <button key={e} type="button" className={`premium-emoji-btn${icon === `e:${e}` ? " is-on" : ""}`} aria-pressed={icon === `e:${e}`} onClick={() => pickEmoji(e)}>
              {e}
            </button>
          ))}
          <input
            className="field premium-emoji-input"
            value={emoji}
            maxLength={16}
            placeholder="Any emoji"
            aria-label="Type or paste any emoji"
            onChange={(e) => pickEmoji(e.target.value)}
          />
        </div>
        {emoji && !cleanEmoji(emoji) ? <p className="hint">Use a single emoji.</p> : null}

        <p className="label premium-sublabel">
          Colour{isEmoji ? " (used for shapes and the picture ring; emoji keep their own colours)" : ""}
        </p>
        <div className="premium-colors">
          {(Object.keys(BADGE_COLORS) as BadgeColor[]).map((c) => (
            <button
              key={c}
              type="button"
              className={`premium-swatch${color === c ? " is-on" : ""}`}
              style={{ background: BADGE_COLORS[c] }}
              aria-pressed={color === c}
              aria-label={c}
              title={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>

        <label className="switch premium-tint">
          <input type="checkbox" checked={tint} onChange={(e) => setTint(e.target.checked)} />
          <span>
            <strong>
              Colour my name <span className="tag tag-premium tag-max">Premium Max</span>
            </strong>
            <span className="hint">Your display name is drawn in your badge colour on posts and your profile.</span>
          </span>
        </label>
      </fieldset>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="settings-row">
        <button type="button" className="btn btn-premium" disabled={locked || needsMax || !!busy || !dirty} onClick={() => void save(draft)}>
          {busy === "save" ? "Saving…" : "Save badge"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={locked || !!busy || !user.badgeChoice || (user.badgeChoice.icon === "check" && user.badgeChoice.color === "blue" && !user.badgeChoice.tintName)}
          onClick={() => {
            setEmoji("");
            void save(null);
          }}
        >
          Reset to blue check
        </button>
        {locked ? (
          <span className="hint">
            Hold {MIN} {SYM} to save.
          </span>
        ) : needsMax ? (
          <span className="hint">
            Pictures and name colour need {MAX_MIN} {SYM}.
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Compare(): React.ReactElement {
  const rows = useMemo(() => {
    const L = (k: keyof typeof BASIC_LIMITS, unit = "") => [BASIC_LIMITS, PREMIUM_LIMITS, MAX_LIMITS].map((l) => `${fmt(l[k])}${unit}`) as [string, string, string];
    return [
      ["Name mark", "Grey seal (verified wallet)", "Blue check, any shape or emoji", "Everything in Premium, or your own picture (GIFs animate)"],
      ["Name colour", "—", "—", "Tinted in your badge colour"],
      ["Post length", ...L("post", " chars")],
      ["Reply length", ...L("reply", " chars")],
      ["Direct messages", ...L("message", " chars")],
      ["Bio", ...L("bio", " chars")],
      ["Display name", ...L("displayName", " chars")],
      ["Posts per 10 min", ...L("postsPer10Min")],
      ["Replies per 10 min", ...L("repliesPer10Min")],
      ["Messages per 10 min", ...L("messagesPer10Min")],
      ["Image storage", ...L("storageX", "×")],
      ["Who to follow", "—", "—", "Featured first"],
      ["Profile tag", "—", "Premium", "Premium Max"],
      ["How to get it", "Sign up", `Hold ${MIN}, or pay its HYPE value for ${PREMIUM.paidDays} days`, `Hold ${MAX_MIN}, or pay its HYPE value for ${PREMIUM.paidDays} days`],
    ] as [string, string, string, string][];
  }, []);
  return (
    <section className="premium-card" aria-labelledby="premium-compare-h">
      <h2 id="premium-compare-h">Basic, Premium and Premium Max</h2>
      <div className="premium-table-wrap">
        <table className="premium-table is-three">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Feature</span>
              </th>
              <th scope="col">
                <span className="premium-th">
                  <IconVerified size={16} /> Basic
                </span>
              </th>
              <th scope="col" className="is-premium">
                <span className="premium-th">
                  <PremiumMark badge={DEFAULT_BADGE} size={17} /> Premium
                </span>
                <small className="premium-th-sub">{MIN}</small>
              </th>
              <th scope="col" className="is-max">
                <span className="premium-th">
                  <PremiumMark badge={MAX_MARK} size={17} /> Max
                </span>
                <small className="premium-th-sub">{MAX_MIN}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, a, b, c]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{a}</td>
                <td className="is-premium">{b}</td>
                <td className="is-max">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Basic is every account. A verified wallet adds the grey seal. Premium replaces it; Premium Max includes everything in Premium with higher
        limits again.
      </p>
    </section>
  );
}

export function Premium(): React.ReactElement {
  const { user, sessionReady } = useApp();
  const [status, setStatus] = useState<PremiumStatus | null>(null);

  useEffect(() => {
    let live = true;
    api
      .premium()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user?.id, user?.walletAddress, user?.walletVerified]);

  return (
    <>
      <header className={`premium-hero${user?.tier === "max" ? " is-max" : ""}`}>
        <span className="premium-hero-mark" aria-hidden="true">
          <PremiumMark badge={user?.premium ? user.badge : DEFAULT_BADGE} size={72} />
        </span>
        <h1>Threadsium Premium</h1>
        <p>
          Hold <strong>{MIN} {SYM}</strong> in your verified wallet for the blue check, a badge you can restyle and higher limits. Hold{" "}
          <strong>{MAX_MIN}</strong> for <strong>Premium Max</strong>: your own picture as the badge, a coloured name, 4× image storage and the
          highest limits. Not holding? Pay the same value in HYPE for {PREMIUM.paidDays} days.
        </p>
      </header>

      {!sessionReady ? (
        <Loom label="Checking your session" />
      ) : user ? (
        <>
          <StatusCard user={user} status={status} onStatus={setStatus} />
          <PayCard user={user} status={status} onStatus={setStatus} />
          <BadgeEditor user={user} />
        </>
      ) : (
        <div className="empty">
          <p>
            <strong>Sign in to check your {SYM} balance.</strong>
          </p>
          <Link className="btn btn-primary" to="/auth?next=%2Fapp%2Fpremium">
            Sign in or create an account
          </Link>
        </div>
      )}
      <Compare />
    </>
  );
}
