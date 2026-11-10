import React from "react";

export function ThreadsiumMark({
  size = 32,
}: {
  size?: number;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="brand-mark-svg"
    >
      <rect width="64" height="64" rx="14" fill="var(--bg-elevated)" />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="12"
        stroke="var(--border-strong)"
        strokeWidth="2"
      />
      <path d="M16 20H48L40 28H24L16 20Z" fill="var(--accent-primary)" />
      <path d="M28 28H36V48L28 42V28Z" fill="var(--accent-gold)" />
      <path
        d="M18 36L28 28V36L22 41L18 36Z"
        fill="var(--accent-primary)"
        fillOpacity="0.72"
      />
      <path
        d="M46 36L36 28V36L42 41L46 36Z"
        fill="var(--accent-primary)"
        fillOpacity="0.72"
      />
    </svg>
  );
}

export interface LoaderStage {
  label: string;
  detail?: string;
  progress: number; // 0..100
}

export function SpoolLoader({
  stage,
  error,
  onRetry,
  compact = false,
}: {
  stage: LoaderStage;
  error?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}): React.ReactElement {
  const pct = Math.max(4, Math.min(100, Math.round(stage.progress)));

  return (
    <div
      className={`spool-loader ${compact ? "spool-loader-compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="spool-loader-visual" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 64 64" fill="none">
          <circle
            cx="32"
            cy="32"
            r="26"
            stroke="var(--border-subtle)"
            strokeWidth="4"
          />
          <circle
            cx="32"
            cy="32"
            r="26"
            stroke="var(--accent-primary)"
            strokeWidth="4"
            strokeDasharray="164"
            strokeDashoffset={Math.round(164 - (164 * pct) / 100)}
            strokeLinecap="round"
            className="spool-ring-progress"
          />
          <path d="M22 24H42L37 30H27L22 24Z" fill="var(--accent-primary)" />
          <path d="M29 30H35V44L29 40V30Z" fill="var(--accent-gold)" />
        </svg>
      </div>
      <div className="spool-loader-copy">
        <div className="spool-loader-header">
          <span className="spool-loader-title">{stage.label}</span>
          <span className="spool-loader-pct">{pct}%</span>
        </div>
        {stage.detail && <p className="spool-loader-detail">{stage.detail}</p>}
        <div className="spool-progress-track" aria-hidden="true">
          <div
            className="spool-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        {error && (
          <div className="spool-loader-error">
            <span>{error}</span>
            {onRetry && (
              <button type="button" className="btn btn-secondary btn-xs" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
