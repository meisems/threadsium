import React from "react";

/** How a room has voted. Green is the bullish share, red the bearish share. */
export function SentimentBar({ bullish, bearish }: { bullish: number; bearish: number }): React.ReactElement {
  const total = bullish + bearish;
  if (!total) return <span className="sentiment sentiment-none">No votes yet</span>;
  const pct = Math.round((bullish / total) * 100);
  return (
    <span className="sentiment" role="img" aria-label={`${pct}% bullish, ${100 - pct}% bearish from ${total} votes`}>
      <span className="sentiment-track">
        <span className="sentiment-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="sentiment-num">{pct}% bullish</span>
    </span>
  );
}
