import React, { useId } from "react";

/* ───────── the Threadsium mark ─────────
   Built on the Elysium logomark's own construction: a disc inside a thin ring, cut by chevrons pitched
   at 30 degrees (Elysium's "mountain" triad: a heavy band, a medium band, a fine band). Threadsium adds
   one thing, a vertical thread. It weaves under the heavy band, over the medium band and under the fine
   band, and the heavy band and the thread together read as a T. All on a 64-unit grid; see /docs#brand.
   Shared with public/brand/*.svg, the favicons and the splash, so change all of them together. */
export const MARK_GEOMETRY = {
  ring: 29.5,
  bar: "M32 12L72 35.09V45.09L32 22L-8 45.09V35.09Z",
  barGap: "M32 22L72 45.09V46.69L32 23.6L-8 46.69V45.09Z",
  med: "M32 26.2L72 49.29V52.69L32 29.6L-8 52.69V49.29Z",
  medCut: "M26.9 26.5H28.5V34H26.9ZM35.5 26.5H37.1V34H35.5Z",
  smallGap: "M32 31L72 54.09V59.49L32 36.4L-8 59.49V54.09Z",
  small: "M32 32.6L72 55.69V57.89L32 34.8L-8 57.89V55.69Z",
  stem: "M28.5 20H35.5V66H28.5Z",
} as const;

/**
 * The mark, in currentColor. Below 22px it drops the two fine bands so the T still reads.
 * `stage` draws it part-way, for the construction figure in the docs: the bare disc, then Elysium's
 * chevrons, then (the default) the thread that makes it Threadsium.
 */
export function Mark({
  size = 28,
  className,
  stage = "full",
}: {
  size?: number;
  className?: string;
  stage?: "disc" | "chevrons" | "full";
}): React.ReactElement {
  const id = useId().replace(/:/g, "");
  const g = MARK_GEOMETRY;
  const fine = size >= 22;
  const thread = stage === "full";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="32" cy="32" r={g.ring} />
        </clipPath>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <circle cx="32" cy="32" r="32" fill="#fff" />
          {stage === "disc" ? (
            <circle cx="32" cy="32" r={g.ring} fill="none" stroke="#000" strokeWidth="0.6" strokeDasharray="1.6 1.6" />
          ) : (
            <g clipPath={`url(#${id}c)`}>
              {thread ? <path d={g.stem} fill="#000" /> : null}
              {thread ? <path d={g.barGap} fill="#fff" /> : null}
              <path d={g.bar} fill="#000" />
              {fine ? (
                <>
                  <path d={g.med} fill="#000" />
                  {thread ? <path d={g.medCut} fill="#fff" /> : null}
                  {thread ? <path d={g.smallGap} fill="#fff" /> : null}
                  <path d={g.small} fill="#000" />
                </>
              ) : null}
            </g>
          )}
        </mask>
      </defs>
      <rect width="64" height="64" fill="currentColor" mask={`url(#${id}m)`} />
    </svg>
  );
}

/** Mark + name, locked up in Elysium's ratios: cap height 0.58 of the disc, gap 0.24 of it. */
export function Wordmark({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <span className="wordmark" style={{ gap: size * 0.24 }} aria-label="Threadsium">
      <Mark size={size} />
      <span className="wordmark-text" style={{ fontSize: size * 0.83 }} aria-hidden="true">
        Threadsium
      </span>
    </span>
  );
}

/**
 * Loading state. Weft threads are drawn across a small loom while work is in progress.
 * `label` names what is actually being loaded; `step`/`total` are shown only when the caller
 * really has discrete stages, so no percentage is ever invented.
 */
export function Loom({
  label,
  detail,
  step,
  total,
  compact = false,
}: {
  label: string;
  detail?: string;
  step?: number;
  total?: number;
  compact?: boolean;
}): React.ReactElement {
  const warp = [8, 17.6, 27.2, 36.8, 46.4, 56];
  const row = (y: number, up: boolean) => {
    // A weft thread that alternates over and under each warp thread.
    let d = `M2 ${y}`;
    let flip = up;
    for (let x = 2; x < 62; x += 9.6) {
      d += ` q4.8 ${flip ? -5 : 5} 9.6 0`;
      flip = !flip;
    }
    return d;
  };
  return (
    <div className={`loom${compact ? " loom-compact" : ""}`} role="status" aria-live="polite">
      <svg className="loom-art" viewBox="0 0 64 40" width={compact ? 48 : 72} height={compact ? 30 : 45} aria-hidden="true">
        {warp.map((x) => (
          <path key={x} d={`M${x} 3v34`} className="loom-warp" />
        ))}
        <path d={row(11, true)} className="loom-weft loom-weft-1" pathLength={100} />
        <path d={row(20, false)} className="loom-weft loom-weft-2" pathLength={100} />
        <path d={row(29, true)} className="loom-weft loom-weft-3" pathLength={100} />
      </svg>
      <div className="loom-text">
        <span className="loom-label">{label}</span>
        {detail ? <span className="loom-detail">{detail}</span> : null}
        {step && total ? (
          <span className="loom-detail">
            Step {step} of {total}
          </span>
        ) : null}
      </div>
    </div>
  );
}
