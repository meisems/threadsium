import React from "react";
import { Link } from "react-router";
import { useApp } from "../state";

type Part =
  | { t: "text"; v: string }
  | { t: "ticker"; v: string }
  | { t: "address"; v: string }
  | { t: "tag"; v: string }
  | { t: "mention"; v: string }
  | { t: "url"; v: string };

const TOKEN_RE = /(\$[A-Za-z][A-Za-z0-9]{0,11}\b)|(\b0x[a-fA-F0-9]{40}\b)|(#[A-Za-z0-9_]{2,32}\b)|(@[A-Za-z0-9_]{3,20}\b)|(https?:\/\/[^\s<>"']+)/g;

export function splitPost(content: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of content.matchAll(TOKEN_RE)) {
    const i = m.index ?? 0;
    const prev = i > 0 ? content[i - 1] : "";
    // "@name" and "$TICKER" only count at a word start, so emails and prices like "5$BOXA" are left alone.
    if ((m[4] || m[1]) && /[A-Za-z0-9_]/.test(prev)) continue;
    if (i > last) parts.push({ t: "text", v: content.slice(last, i) });
    if (m[1]) parts.push({ t: "ticker", v: m[1] });
    else if (m[2]) parts.push({ t: "address", v: m[2] });
    else if (m[3]) parts.push({ t: "tag", v: m[3] });
    else if (m[4]) parts.push({ t: "mention", v: m[4] });
    else {
      const trimmed = m[5].replace(/[.,;:!?)\]]+$/, "");
      parts.push({ t: "url", v: trimmed });
      if (trimmed.length < m[5].length) parts.push({ t: "text", v: m[5].slice(trimmed.length) });
    }
    last = i + m[0].length;
  }
  if (last < content.length) parts.push({ t: "text", v: content.slice(last) });
  return parts;
}

/** Post text with $tickers, contract addresses, #tags, @people and links made tappable. Everything else is plain text. */
export function RichText({ text }: { text: string }): React.ReactElement {
  const { tokenBySymbol } = useApp();
  return (
    <>
      {splitPost(text).map((p, i) => {
        switch (p.t) {
          case "text":
            return <React.Fragment key={i}>{p.v}</React.Fragment>;
          case "ticker": {
            const tok = tokenBySymbol(p.v);
            return (
              <Link key={i} className="ref ref-ticker" to={tok ? `/app/token/${tok.address}` : `/app/search?q=${encodeURIComponent(p.v)}`}>
                {p.v.toUpperCase()}
              </Link>
            );
          }
          case "address":
            return (
              <Link key={i} className="ref ref-address" to={`/app/token/${p.v.toLowerCase()}`} title={p.v}>
                {p.v.slice(0, 6)}…{p.v.slice(-4)}
              </Link>
            );
          case "tag":
            return (
              <Link key={i} className="ref" to={`/app/search?q=${encodeURIComponent(p.v)}`}>
                {p.v}
              </Link>
            );
          case "mention":
            return (
              <Link key={i} className="ref" to={`/app/u/${p.v.slice(1)}`}>
                {p.v}
              </Link>
            );
          case "url": {
            let label = p.v.replace(/^https?:\/\//, "");
            if (label.length > 38) label = `${label.slice(0, 36)}…`;
            return (
              <a key={i} className="ref" href={p.v} target="_blank" rel="noopener noreferrer nofollow ugc">
                {label}
              </a>
            );
          }
        }
      })}
    </>
  );
}
