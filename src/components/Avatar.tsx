import React, { useEffect, useState } from "react";

export const WEAVES: { id: string; name: string; bg: string; warp: string; weft: string }[] = [
  { id: "saffron", name: "Lime", bg: "#9FC131", warp: "#1E0E3E", weft: "#F4F5F0" },
  { id: "iris", name: "Plum", bg: "#1E0E3E", warp: "#120E1E", weft: "#9FC131" },
  { id: "dusk", name: "Violet", bg: "#5B3FD9", warp: "#1E0E3E", weft: "#EBE5FF" },
  { id: "ember", name: "Gold", bg: "#FFBA00", warp: "#1E0E3E", weft: "#FFF8E1" },
  { id: "meadow", name: "Canopy", bg: "#2F5E1E", warp: "#14290B", weft: "#9FC131" },
  { id: "tide", name: "Ivory", bg: "#E7EFCC", warp: "#1E0E3E", weft: "#5B3FD9" },
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

const MONO_HUES = ["#1E0E3E", "#48630A", "#5B3FD9", "#2F5E1E", "#8A6300", "#352852"];

// Session-wide fast logo status memory so already-resolved logos never flicker on navigation
const logoStatusMemory = new Map<string, "ok" | "none">();

/** Token logo from /api/logo (Fast-Track multi-source pipeline), with an instant monogram underneath. */
export function TokenMark({
  address,
  symbol,
  size = 36,
  imageUrl,
}: {
  address: string;
  symbol: string;
  size?: number;
  imageUrl?: string | null;
}): React.ReactElement {
  const addr = address.toLowerCase();
  const memKey = `tok:${addr}`;
  const [state, setState] = useState<"loading" | "ok" | "none">(
    () => logoStatusMemory.get(memKey) ?? "loading"
  );

  useEffect(() => {
    setState(logoStatusMemory.get(`tok:${addr}`) ?? "loading");
  }, [addr]);

  const color = MONO_HUES[hash(addr) % MONO_HUES.length];
  const text = (symbol || "?").replace(/^\$/, "").slice(0, size < 30 ? 2 : 4).toUpperCase();
  const src = imageUrl
    ? `/api/logo/${addr}?src=${encodeURIComponent(imageUrl)}`
    : `/api/logo/${addr}`;

  return (
    <span
      className="token-mark"
      style={{
        width: size,
        height: size,
        background: state === "ok" ? "transparent" : color,
      }}
    >
      {state !== "ok" ? (
        <span
          className="token-mark-text"
          style={{
            fontSize: Math.max(9, Math.round(size * (text.length > 3 ? 0.27 : 0.34))),
          }}
        >
          {text}
        </span>
      ) : null}
      {state !== "none" ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading={size >= 36 ? "eager" : "lazy"}
          decoding="async"
          style={{ opacity: state === "ok" ? 1 : 0 }}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 0) {
              logoStatusMemory.set(memKey, "ok");
              setState("ok");
            } else {
              logoStatusMemory.set(memKey, "none");
              setState("none");
            }
          }}
          onError={() => {
            logoStatusMemory.set(memKey, "none");
            setState("none");
          }}
        />
      ) : null}
    </span>
  );
}

/** Launchpad logo from /api/launchpad-logo/:id (discovered from launchpad <head> or platform token), with monogram fallback. */
export function LaunchpadMark({
  id,
  name,
  size = 34,
}: {
  id: string;
  name: string;
  size?: number;
}): React.ReactElement {
  const cleanId = id.toLowerCase();
  const memKey = `lp:${cleanId}`;
  const [state, setState] = useState<"loading" | "ok" | "none">(
    () => logoStatusMemory.get(memKey) ?? "loading"
  );

  useEffect(() => {
    setState(logoStatusMemory.get(`lp:${cleanId}`) ?? "loading");
  }, [cleanId]);

  const color = MONO_HUES[hash(cleanId) % MONO_HUES.length];
  const text = (name || cleanId || "LP")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, size < 28 ? 2 : 3)
    .toUpperCase();

  return (
    <span
      className="token-mark launchpad-mark"
      style={{
        width: size,
        height: size,
        background: state === "ok" ? "transparent" : color,
      }}
    >
      {state !== "ok" ? (
        <span
          className="token-mark-text"
          style={{ fontSize: Math.max(9, Math.round(size * 0.32)) }}
        >
          {text}
        </span>
      ) : null}
      {state !== "none" ? (
        <img
          src={`/api/launchpad-logo/${cleanId}`}
          alt=""
          width={size}
          height={size}
          loading={size >= 48 ? "eager" : "lazy"}
          decoding="async"
          style={{ opacity: state === "ok" ? 1 : 0 }}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth > 0) {
              logoStatusMemory.set(memKey, "ok");
              setState("ok");
            } else {
              logoStatusMemory.set(memKey, "none");
              setState("none");
            }
          }}
          onError={() => {
            logoStatusMemory.set(memKey, "none");
            setState("none");
          }}
        />
      ) : null}
    </span>
  );
}
