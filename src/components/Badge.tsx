// Account marks next to a name.
// Basic: the monochrome seal for a signature-verified wallet.
// Premium: a coloured badge (blue check by default) the holder can swap for another shape or any emoji.
// Premium Max: all of that, or their own uploaded picture, and optionally their name in the badge colour.
import React from "react";
import { Link } from "react-router";
import { BADGE_COLORS, DEFAULT_BADGE, PREMIUM, TIER_LABEL, type Badge, type Tier } from "../config/premium";
import type { UserLite } from "../lib/api";
import { IconVerified } from "./icons";

/** Scalloped rosette on a 24 grid: `lobes` bumps between radius r (valleys) and R (peaks). */
function rosette(lobes = 10, R = 11.2, r = 9.4): string {
  const pt = (rad: number, a: number) => `${(12 + rad * Math.cos(a)).toFixed(2)} ${(12 + rad * Math.sin(a)).toFixed(2)}`;
  const step = (Math.PI * 2) / lobes;
  const start = -Math.PI / 2;
  let d = `M${pt(r, start)}`;
  for (let i = 0; i < lobes; i++) {
    const a0 = start + i * step;
    d += ` Q${pt(R * 1.06, a0 + step / 2)} ${pt(r, a0 + step)}`;
  }
  return `${d}Z`;
}
const ROSETTE = rosette();

/** Each glyph: filled shape in the badge colour, optional inner mark in white (or `ring`: a stroke in the badge colour). */
const GLYPHS: Record<string, { label: string; fill: string; mark?: string; markFill?: boolean; ring?: string }> = {
  check: { label: "Blue check", fill: ROSETTE, mark: "m7.6 12.3 3 3 5.9-6.3" },
  star: { label: "Star", fill: "M12 2.2l2.95 6.2 6.8.85-5 4.7 1.3 6.75L12 17.4l-6.05 3.3 1.3-6.75-5-4.7 6.8-.85z" },
  bolt: { label: "Bolt", fill: "M13.6 1.8 4.4 13.5h6.1l-1.6 8.7 9.6-12.1h-6.3z" },
  diamond: { label: "Diamond", fill: "M7 3.5h10l4.3 5.4L12 21 2.7 8.9z", mark: "M2.9 8.9h18.2M9.2 3.6 7.6 8.9 12 20.6l4.4-11.7-1.6-5.3", markFill: false },
  flame: {
    label: "Flame",
    fill: "M12.4 1.9c.6 3.3 4.1 5.2 5.6 8.4 1.9 4.1-.3 10.9-6.2 10.9-4.4 0-7-3.3-6.6-7.2.3-2.6 2-4.3 3-5.4.3 1.6 1 2.7 2.1 3.3-.5-3.7.6-7.3 2.1-10z",
  },
  crown: { label: "Crown", fill: "M3 7.5l4.6 4 4.4-6.7 4.4 6.7 4.6-4-1.7 11H4.7zM4.8 19.8h14.4v1.9H4.8z" },
  moon: { label: "Moon", fill: "M15.6 2.6A9.7 9.7 0 1 0 21.4 15 7.9 7.9 0 0 1 15.6 2.6z" },
  heart: { label: "Heart", fill: "M12 21.1S2.3 15.2 2.3 8.6A5.1 5.1 0 0 1 12 6.1a5.1 5.1 0 0 1 9.7 2.5c0 6.6-9.7 12.5-9.7 12.5z" },
  leaf: { label: "Leaf", fill: "M20.6 3.2C10.5 2.4 3.4 7.6 4.1 16.4L2.6 20l1.6.8 1.6-3.3c8.4.7 14.8-4.8 14.8-14.3z", mark: "M5.7 17.5c3-4.4 6.4-7.5 10.6-9.6", markFill: false },
  rocket: {
    label: "Rocket",
    fill: "M14.6 2.4c3.2-.8 6.2-.6 7 .1.7.8.9 3.8.1 7-1 3.9-4.7 7.5-7.9 9.4l-.6 3.4-3.3-2.6-4.1-4.1-2.6-3.3 3.4-.6c1.9-3.2 5.5-6.9 8-9.3zM6.3 15.3l2.4 2.4c-1.2 2.3-3.5 3.6-6.2 3.9.3-2.7 1.6-5 3.8-6.3z",
    mark: "M16.6 9.1a1.8 1.8 0 1 0 0-.01",
    markFill: true,
  },
  orbit: {
    label: "Orbit",
    fill: "M12 5.8a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4z",
    ring: "M2.1 16.6A10.9 3.5 -25 0 0 21.9 7.4",
  },
  thread: { label: "Thread", fill: ROSETTE, mark: "M7.8 9.2h8.4M12 9.2v7M8.6 13.4c1.6 1.4 5.2 1.4 6.8 0", markFill: false },
};

export const badgeLabel = (icon: string): string =>
  icon === "img" ? "Your picture" : icon.startsWith("e:") ? `${icon.slice(2)} emoji` : (GLYPHS[icon]?.label ?? "Badge");

/** The premium mark itself, at `size` px. */
export function PremiumMark({ badge, size = 16, title }: { badge: Badge | null | undefined; size?: number; title?: string }): React.ReactElement {
  const b = badge ?? DEFAULT_BADGE;
  const color = BADGE_COLORS[b.color] ?? BADGE_COLORS.blue;
  if (b.icon === "img" && b.image) {
    return (
      <img
        className="premium-pic"
        src={b.image}
        width={size}
        height={size}
        alt={title ?? ""}
        title={title}
        loading="lazy"
        decoding="async"
        style={{ boxShadow: `0 0 0 ${size >= 40 ? 3 : 1.5}px ${color}` }}
      />
    );
  }
  if (b.icon.startsWith("e:")) {
    return (
      <span className="premium-emoji" style={{ fontSize: Math.round(size * 0.92), width: size, height: size }} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        {b.icon.slice(2)}
      </span>
    );
  }
  const g = GLYPHS[b.icon] ?? GLYPHS.check;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="premium-mark" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d={g.fill} fill={color} />
      {g.ring ? (
        <>
          <path d={g.ring} fill="none" stroke="var(--surface, #fff)" strokeWidth="4" strokeLinecap="round" />
          <path d={g.ring} fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
        </>
      ) : null}
      {g.mark ? (
        g.markFill ? (
          <path d={g.mark} fill="#fff" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        ) : (
          <path d={g.mark} fill="none" stroke="#fff" strokeWidth={b.icon === "check" ? 2.4 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={b.icon === "check" ? 1 : 0.9} />
        )
      ) : null}
    </svg>
  );
}

const tierTitle = (tier: Tier | undefined) =>
  tier === "max"
    ? `Threadsium ${TIER_LABEL.max}: holds ${PREMIUM.maxMinTokens.toLocaleString("en-US")} ${PREMIUM.symbol}`
    : `Threadsium Premium: holds ${PREMIUM.minTokens.toLocaleString("en-US")} ${PREMIUM.symbol}`;

/** Premium Max holders can draw their display name in their badge colour. */
export function nameStyle(user: Pick<UserLite, "badge">): React.CSSProperties | undefined {
  return user.badge?.tintName ? { color: BADGE_COLORS[user.badge.color] ?? undefined } : undefined;
}

/**
 * The mark shown after a name: premium badge, else the verified-wallet seal, else nothing.
 * `linked` makes the premium badge open the Premium page (leave off inside other links).
 */
export function UserBadge({
  user,
  size = 15,
  linked = false,
}: {
  user: Pick<UserLite, "premium" | "badge" | "walletVerified"> & { tier?: Tier };
  size?: number;
  linked?: boolean;
}): React.ReactElement | null {
  if (user.premium) {
    const PREMIUM_TITLE = tierTitle(user.tier);
    const mark = <PremiumMark badge={user.badge} size={size + 1} title={PREMIUM_TITLE} />;
    return linked ? (
      <Link to="/app/premium" className="verified is-premium" title={PREMIUM_TITLE} onClick={(e) => e.stopPropagation()}>
        {mark}
      </Link>
    ) : (
      <span className="verified is-premium" title={PREMIUM_TITLE}>
        {mark}
      </span>
    );
  }
  if (user.walletVerified) {
    return (
      <span className="verified" title="Wallet ownership verified by signature">
        <IconVerified size={size} title="Verified wallet" />
      </span>
    );
  }
  return null;
}

export const BADGE_GLYPH_LABELS = Object.fromEntries(Object.entries(GLYPHS).map(([k, v]) => [k, v.label])) as Record<string, string>;
