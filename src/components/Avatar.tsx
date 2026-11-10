import React, { useEffect, useState } from "react";

export const WEAVES: { id: string; name: string; bg: string; warp: string; weft: string }[] = [
  { id: "saffron", name: "Nitro", bg: "#FB5607", warp: "#191970", weft: "#E9ECEF" },
  { id: "iris", name: "Royal", bg: "#191970", warp: "#0E0E42", weft: "#FB5607" },
  { id: "dusk", name: "Blackstone", bg: "#212529", warp: "#111316", weft: "#E9ECEF" },
  { id: "ember", name: "Whiteout", bg: "#DDE2E6", warp: "#212529", weft: "#FB5607" },
  { id: "meadow", name: "Meadow", bg: "#1E8A63", warp: "#0E3B2B", weft: "#E9ECEF" },
  { id: "tide", name: "Tide", bg: "#1F5FA8", warp: "#191970", weft: "#E9ECEF" },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A woven patch generated from the username: every account gets its own over-under pattern,
 * coloured by the weave it picked (or one chosen from the name).
 */
export function WeavePatch({ seed, preset, size }: { seed: string; preset?: string | null; size: number }): React.ReactElement {
  const h = hash(seed.toLowerCase());
  const weave = WEAVES.find((w) => w.id === preset) ?? WEAVES[h % WEAVES.length];
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      // Plain weave as the base, with name-dependent floats so no two patches match.
      const base = (x + y) % 2 === 0;
      const flip = ((h >> (y * 4 + x)) & 1) === 1 && ((h >> (16 + ((y * 4 + x) % 12))) & 1) === 1;
      const over = base !== flip;
      cells.push(
        over ? (
          <rect key={`${x}-${y}`} x={x * 10 + 0.8} y={y * 10 + 2.4} width="8.4" height="5.2" rx="1.6" fill={weave.weft} />
        ) : (
          <rect key={`${x}-${y}`} x={x * 10 + 2.4} y={y * 10 + 0.8} width="5.2" height="8.4" rx="1.6" fill={weave.warp} />
        ),
      );
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="weave">
      <rect width="40" height="40" fill={weave.bg} />
      {cells}
    </svg>
  );
}

export function Avatar({
  user,
  size = 40,
  className = "",
}: {
  user: { username: string; avatarUrl: string | null; avatarPreset: string | null; displayName?: string };
  size?: number;
  className?: string;
}): React.ReactElement {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [user.avatarUrl]);
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size }}>
      {user.avatarUrl && !broken ? (
        <img src={user.avatarUrl} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <WeavePatch seed={user.username} preset={user.avatarPreset} size={size} />
      )}
    </span>
  );
}

const MONO_HUES = ["#191970", "#FB5607", "#212529", "#1E8A63", "#1F5FA8", "#B83B00"];

/** Token logo from /api/logo (the Worker finds it from launchpads and on-chain metadata), with a monogram underneath. */
export function TokenMark({ address, symbol, size = 36 }: { address: string; symbol: string; size?: number }): React.ReactElement {
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  useEffect(() => setState("loading"), [address]);
  const color = MONO_HUES[hash(address.toLowerCase()) % MONO_HUES.length];
  const text = (symbol || "?").replace(/^\$/, "").slice(0, size < 30 ? 2 : 4).toUpperCase();
  return (
    <span className="token-mark" style={{ width: size, height: size, background: state === "ok" ? "transparent" : color }}>
      {state !== "ok" ? (
        <span className="token-mark-text" style={{ fontSize: Math.max(9, Math.round(size * (text.length > 3 ? 0.27 : 0.34))) }}>
          {text}
        </span>
      ) : null}
      {state !== "none" ? (
        <img
          src={`/api/logo/${address.toLowerCase()}`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style={{ opacity: state === "ok" ? 1 : 0 }}
          onLoad={() => setState("ok")}
          onError={() => setState("none")}
        />
      ) : null}
    </span>
  );
}
