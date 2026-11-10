import React, { useState } from "react";

export interface AvatarPreset {
  id: string;
  name: string;
  role: string;
  bg: string;
  accent: string;
  secondary: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "kinepip-samurai",
    name: "Kinetiq Vanguard",
    role: "99901 Block Sequencer",
    bg: "#0F241D",
    accent: "#32D79B",
    secondary: "#E6B84D",
  },
  {
    id: "asphodel-owl",
    name: "Asphodel Watcher",
    role: "Archive Log Indexer",
    bg: "#161B26",
    accent: "#6EA8FE",
    secondary: "#32D79B",
  },
  {
    id: "hyper-bull",
    name: "WHYPE Sovereign",
    role: "Liquidity Trench Bull",
    bg: "#231B0E",
    accent: "#E6B84D",
    secondary: "#F59E0B",
  },
  {
    id: "obsidian-diver",
    name: "Obsidian Diver",
    role: "Deep Pool Arbitrageur",
    bg: "#1A1326",
    accent: "#C084FC",
    secondary: "#32D79B",
  },
  {
    id: "v4-hooksmith",
    name: "V4 Hooksmith",
    role: "Singleton Pool Architect",
    bg: "#0E2226",
    accent: "#22D3EE",
    secondary: "#E6B84D",
  },
  {
    id: "kleos-oracle",
    name: "Kleos Oracle",
    role: "Bonding Curve Strategist",
    bg: "#261319",
    accent: "#FB7185",
    secondary: "#FBBF24",
  },
];

export function AvatarSvg({
  avatarId,
  size = 40,
}: {
  avatarId: string;
  size?: number;
}): React.ReactElement {
  const preset =
    AVATAR_PRESETS.find((a) => a.id === avatarId) || AVATAR_PRESETS[0];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block", borderRadius: "50%", flexShrink: 0 }}
    >
      <rect width="64" height="64" rx="32" fill={preset.bg} />
      <circle
        cx="32"
        cy="32"
        r="29"
        stroke={preset.accent}
        strokeOpacity="0.35"
        strokeWidth="2"
      />
      {preset.id === "kinepip-samurai" && (
        <>
          <path d="M16 26L32 14L48 26L42 46H22L16 26Z" fill={preset.accent} fillOpacity="0.22" />
          <path d="M20 26L32 18L44 26L32 32L20 26Z" fill={preset.accent} />
          <rect x="24" y="34" width="16" height="4" rx="2" fill={preset.secondary} />
          <circle cx="26" cy="30" r="2.2" fill="#FFFFFF" />
          <circle cx="38" cy="30" r="2.2" fill="#FFFFFF" />
        </>
      )}
      {preset.id === "asphodel-owl" && (
        <>
          <path d="M18 22L26 16L32 22L38 16L46 22V42L32 50L18 42V22Z" fill={preset.accent} fillOpacity="0.24" />
          <circle cx="25" cy="31" r="6" stroke={preset.accent} strokeWidth="2.5" />
          <circle cx="39" cy="31" r="6" stroke={preset.accent} strokeWidth="2.5" />
          <circle cx="25" cy="31" r="2.5" fill={preset.secondary} />
          <circle cx="39" cy="31" r="2.5" fill={preset.secondary} />
          <path d="M32 35L29 41H35L32 35Z" fill={preset.secondary} />
        </>
      )}
      {preset.id === "hyper-bull" && (
        <>
          <path d="M14 18L22 26H42L50 18L46 30L40 46H24L18 30L14 18Z" fill={preset.accent} fillOpacity="0.25" />
          <path d="M14 18L24 24V29L16 25L14 18Z" fill={preset.accent} />
          <path d="M50 18L40 24V29L48 25L50 18Z" fill={preset.accent} />
          <circle cx="26" cy="33" r="2.5" fill="#FFFFFF" />
          <circle cx="38" cy="33" r="2.5" fill="#FFFFFF" />
          <rect x="27" y="40" width="10" height="4" rx="2" fill={preset.secondary} />
        </>
      )}
      {preset.id === "obsidian-diver" && (
        <>
          <circle cx="32" cy="32" r="16" fill={preset.accent} fillOpacity="0.2" stroke={preset.accent} strokeWidth="2.5" />
          <rect x="22" y="27" width="20" height="10" rx="5" fill={preset.secondary} fillOpacity="0.85" />
          <path d="M32 16V22M32 42V48M16 32H22M42 32H48" stroke={preset.accent} strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}
      {preset.id === "v4-hooksmith" && (
        <>
          <path d="M22 20H42L46 32L32 48L18 32L22 20Z" fill={preset.accent} fillOpacity="0.22" />
          <path d="M26 24H38V34C38 37.3137 35.3137 40 32 40C28.6863 40 26 37.3137 26 34V24Z" stroke={preset.accent} strokeWidth="3" />
          <circle cx="32" cy="31" r="3" fill={preset.secondary} />
        </>
      )}
      {preset.id === "kleos-oracle" && (
        <>
          <polygon points="32,14 48,32 32,50 16,32" fill={preset.accent} fillOpacity="0.24" stroke={preset.accent} strokeWidth="2" />
          <circle cx="32" cy="32" r="6" fill={preset.secondary} />
          <circle cx="32" cy="32" r="2.5" fill={preset.bg} />
        </>
      )}
    </svg>
  );
}

export function UserAvatar({
  avatarId,
  avatarUrl,
  username,
  size = 40,
  className = "",
}: {
  avatarId?: string | null;
  avatarUrl?: string | null;
  username?: string;
  size?: number;
  className?: string;
}): React.ReactElement {
  const [imgErr, setImgErr] = useState(false);

  if (avatarUrl && !imgErr) {
    return (
      <img
        src={avatarUrl}
        alt={username ? `@${username}` : "User avatar"}
        width={size}
        height={size}
        className={`user-avatar-img ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
        onError={() => setImgErr(true)}
      />
    );
  }

  return <AvatarSvg avatarId={avatarId || "kinepip-samurai"} size={size} />;
}

export function TokenMark({
  address,
  symbol,
  size = 36,
}: {
  address: string;
  symbol: string;
  size?: number;
}): React.ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const cleanSym = (symbol || "TKN").replace(/^\$/, "").slice(0, 4).toUpperCase();
  const hue =
    address
      .toLowerCase()
      .split("")
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 140) % 360;

  return (
    <div
      className="token-mark"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        position: "relative",
        overflow: "hidden",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `hsl(${hue} 42% 16%)`,
        border: `1px solid hsl(${hue} 58% 36% / 0.55)`,
        color: `hsl(${hue} 85% 78%)`,
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.31)),
      }}
    >
      <span>{cleanSym}</span>
      {!failed && address && /^0x[a-fA-F0-9]{40}$/.test(address) && (
        <img
          src={`/api/logo/${address.toLowerCase()}`}
          alt={symbol}
          width={size}
          height={size}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loaded ? 1 : 0,
            transition: "opacity 160ms ease",
          }}
        />
      )}
    </div>
  );
}
