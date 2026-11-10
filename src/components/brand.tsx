import React from "react";

/** The Threadsium mark: a thread looped over a bar, reading as a T. The left leg passes in front. */
export function Mark({ size = 28, className }: { size?: number; className?: string }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path d="M25 55V20a7 7 0 0 1 14 0v35" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M12 26h40" stroke="#8c8c8c" strokeWidth="7.5" strokeLinecap="round" />
      <path d="M25 55V21" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <span className="wordmark">
      <Mark size={size} />
      <span className="wordmark-text">Threadsium</span>
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
