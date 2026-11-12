// Threadsium's own icon set: 24 px grid, 1.75 px round strokes, drawn for this interface.
import React from "react";

type P = { size?: number; className?: string; filled?: boolean; title?: string };

function Svg({ size = 22, className, title, children, viewBox = "0 0 24 24" }: P & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Svg {...p}>
    <path d="M4 11.2 12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" fill={p.filled ? "currentColor" : "none"} />
  </Svg>
);
/** Rooms: a doorway arch with a thread running through it. */
export const IconRooms = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V11a7 7 0 0 1 14 0v9" fill={p.filled ? "currentColor" : "none"} fillOpacity={p.filled ? 0.18 : 0} />
    <path d="M3 20h18M9.5 20v-7.5a2.5 2.5 0 0 1 5 0V20" />
  </Svg>
);
/** Launchpads: an ascending beacon / launch stage with orbital rings. */
export const IconLaunchpads = (p: P) => (
  <Svg {...p}>
    <path
      d="M12 3.5c3.2 2.4 4.8 5.6 4.8 9.2 0 1.3-.3 2.5-.8 3.6H8c-.5-1.1-.8-2.3-.8-3.6 0-3.6 1.6-6.8 4.8-9.2z"
      fill={p.filled ? "currentColor" : "none"}
      fillOpacity={p.filled ? 0.2 : 0}
    />
    <circle cx="12" cy="10.5" r="1.8" />
    <path d="M8 13.5 5 16v2.5l3-1.2M16 13.5l3 2.5v2.5l-3-1.2M9.5 19.5h5" />
  </Svg>
);
export const IconBell = (p: P) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" fill={p.filled ? "currentColor" : "none"} />
    <path d="M10 21h4" />
  </Svg>
);
export const IconMail = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="3" fill={p.filled ? "currentColor" : "none"} fillOpacity={p.filled ? 0.18 : 0} />
    <path d="m4 8 8 5.5L20 8" />
  </Svg>
);
export const IconBookmark = (p: P) => (
  <Svg {...p}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" fill={p.filled ? "currentColor" : "none"} />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.8" fill={p.filled ? "currentColor" : "none"} />
    <path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.700 1.900 7.500 5.500" fill={p.filled ? "currentColor" : "none"} />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2.2" />
    <circle cx="9" cy="17" r="2.2" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.2" />
    <path d="m16 16 4 4" />
  </Svg>
);
/** Compose: a needle pulling thread. */
export const IconCompose = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 4.500 9 15" />
    <path d="M19.5 4.500c-2.200-.4-4 .2-5.300 1.500" />
    <path d="M9 15c-2 .3-3.600 1.300-4 3.500 2.600.6 4.300-.5 5-2.500" />
    <path d="M12.500 20H20" />
  </Svg>
);
export const IconReply = (p: P) => (
  <Svg {...p}>
    <path d="M20 11.500a7.500 7.500 0 0 1-11 6.600L4.500 19.500l1.300-4.200A7.500 7.500 0 1 1 20 11.500z" />
  </Svg>
);
export const IconRepost = (p: P) => (
  <Svg {...p}>
    <path d="M7 7h9a3 3 0 0 1 3 3v3" />
    <path d="m9.500 4.500-2.500 2.500 2.500 2.500" />
    <path d="M17 17H8a3 3 0 0 1-3-3v-3" />
    <path d="m14.500 19.500 2.500-2.500-2.500-2.500" />
  </Svg>
);
export const IconQuote = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.500c0-3 1.500-5 4.500-5.500M5 12.500h4V17H5zM14 12.500c0-3 1.500-5 4.500-5.500M14 12.500h4V17h-4z" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V4M8 7.500 12 4l4 3.500" />
    <path d="M5 12.500V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.500" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5.500" cy="12" r="1.100" fill="currentColor" />
    <circle cx="12" cy="12" r="1.100" fill="currentColor" />
    <circle cx="18.500" cy="12" r="1.100" fill="currentColor" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="3.500" y="4.500" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.600" />
    <path d="m5 18 5-4.500 3.500 3L16 14l4 3.500" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.500 4.500 4.500L19 7.500" />
  </Svg>
);
/** Verified wallet: a stitched seal. */
export const IconVerified = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.500" fill="currentColor" stroke="none" />
    <path d="m8.300 12.300 2.500 2.500 4.900-5.200" stroke="var(--on-iris)" strokeWidth="2" />
  </Svg>
);
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M5 7h14M10 7V5h4v2M7 7l1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" />
  </Svg>
);
export const IconEdit = (p: P) => (
  <Svg {...p}>
    <path d="M5 19l1-4L16.500 4.500l3 3L9 18z" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M13 5h6v6M19 5l-8.500 8.500M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4" />
  </Svg>
);
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconStar = (p: P) => (
  <Svg {...p}>
    <path
      d="m12 4 2.400 5 5.400.700-4 3.800 1 5.500L12 16.400 7.200 19l1-5.500-4-3.800 5.400-.700z"
      fill={p.filled ? "currentColor" : "none"}
    />
  </Svg>
);
export const IconDocs = (p: P) => (
  <Svg {...p}>
    <path d="M6 4h9l4 4v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M14.500 4v4.500H19M8.500 12.500h7M8.500 16h5" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M14 5H7a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7M11 12h9M17 8.500l3.500 3.500-3.500 3.500" />
  </Svg>
);
export const IconWallet = (p: P) => (
  <Svg {...p}>
    <path d="M4 7.500A2.500 2.500 0 0 1 6.500 5H17v3M4 7.500V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.500A2.500 2.500 0 0 1 4 7.500z" />
    <circle cx="16" cy="13.500" r="1" fill="currentColor" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="8.500" y="8.500" width="11" height="11" rx="2.500" />
    <path d="M15.500 8.500V6.500a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Svg>
);
export const IconUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V6M6.500 11 12 5.500 17.500 11" />
  </Svg>
);
export const IconDown = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v13M6.500 13l5.500 5.500 5.500-5.500" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
/** Swap: two opposed arrows on parallel rails. */
export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M5 8.500h13M14.500 5 18 8.500 14.500 12M19 15.500H6M9.500 12 6 15.500 9.500 19" />
  </Svg>
);
/** Send / tip: a paper plane leaving a short trail. */
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M20 4 3.500 10.800l6.300 2.400L20 4zm0 0-6.700 16-3.500-6.800" fill={p.filled ? "currentColor" : "none"} fillOpacity={p.filled ? 0.18 : 0} />
  </Svg>
);
/** Whale watch: a wake line under a rising fin. */
export const IconWake = (p: P) => (
  <Svg {...p}>
    <path d="M7 14c1.800-4.800 5.200-8 10-9-1.400 2.600-1.700 5.600-.8 9" fill={p.filled ? "currentColor" : "none"} fillOpacity={p.filled ? 0.18 : 0} />
    <path d="M3 17.500c1.500 0 1.500-1.200 3-1.200s1.500 1.200 3 1.200 1.500-1.200 3-1.200 1.500 1.200 3 1.200 1.500-1.200 3-1.200 1.500 1.200 3 1.200" />
  </Svg>
);

/* Reaction glyphs. Each is a small filled badge so a stack of them stays legible at 18 px. */
export function ReactionGlyph({ kind, size = 20 }: { kind: "like" | "bull" | "bear" | "haha" | "eyes"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const, className: `rx rx-${kind}` };
  switch (kind) {
    case "like":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" className="rx-bg" />
          <path
            d="M12 18s-5.500-3.300-5.500-7.200A3 3 0 0 1 12 9.200a3 3 0 0 1 5.500 1.600C17.500 14.700 12 18 12 18z"
            className="rx-fg"
          />
        </svg>
      );
    case "bull":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" className="rx-bg" />
          <path d="M12 6.500 17.500 13h-3.300v4.500H9.800V13H6.500z" className="rx-fg" />
        </svg>
      );
    case "bear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" className="rx-bg" />
          <path d="M12 17.500 6.500 11h3.300V6.500h4.400V11h3.300z" className="rx-fg" />
        </svg>
      );
    case "haha":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" className="rx-bg" />
          <path d="M6.800 12.500h10.400a5.200 5.200 0 0 1-10.400 0z" className="rx-fg" />
          <path d="m7 9.500 2.200-1.200M17 9.500l-2.200-1.200" stroke="var(--rx-ink)" strokeWidth="1.700" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "eyes":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="11" className="rx-bg" />
          <ellipse cx="8.300" cy="12" rx="2.700" ry="3.600" className="rx-fg" />
          <ellipse cx="15.700" cy="12" rx="2.700" ry="3.600" className="rx-fg" />
          <circle cx="9.200" cy="12.800" r="1.300" fill="var(--rx-ink)" />
          <circle cx="16.600" cy="12.800" r="1.300" fill="var(--rx-ink)" />
        </svg>
      );
  }
}

export const REACTION_LABEL: Record<"like" | "bull" | "bear" | "haha" | "eyes", string> = {
  like: "Like",
  bull: "Bullish",
  bear: "Bearish",
  haha: "Funny",
  eyes: "Watching",
};
