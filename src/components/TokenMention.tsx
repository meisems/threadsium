import React from "react";
import { Link } from "react-router";
import { DirectoryToken } from "../lib/api";
import { SEEDED_TOKENS } from "../config/tokens";
import { shortAddr } from "../lib/format";

const TOKEN_PATTERN =
  /(\$(?:[A-Za-z][A-Za-z0-9_]{1,11})\b|\b0x[a-fA-F0-9]{40}\b|#[A-Za-z0-9_]{2,32}\b|@[a-zA-Z0-9_]{3,20}\b)/g;

export function resolveTickerAddress(
  ticker: string,
  directory: DirectoryToken[] = []
): string | null {
  const up = ticker.replace(/^\$/, "").toUpperCase();
  const fromDir = directory.find((t) => t.symbol.toUpperCase() === up);
  if (fromDir) return fromDir.address.toLowerCase();
  const seeded = SEEDED_TOKENS.find((t) => t.symbol.toUpperCase() === up);
  if (seeded) return seeded.address.toLowerCase();
  return null;
}

export function RichPostText({
  content,
  directory = [],
}: {
  content: string;
  directory?: DirectoryToken[];
}): React.ReactElement {
  const parts = content.split(TOKEN_PATTERN);

  return (
    <span className="rich-post-text">
      {parts.map((part, idx) => {
        if (!part) return null;

        if (part.startsWith("$") && part.length > 1) {
          const sym = part.slice(1).toUpperCase();
          const addr = resolveTickerAddress(sym, directory);
          if (addr) {
            return (
              <Link
                key={idx}
                to={`/app/token/${addr}`}
                className="mention-pill mention-ticker"
                onClick={(e) => e.stopPropagation()}
              >
                ${sym}
              </Link>
            );
          }
          return (
            <Link
              key={idx}
              to={`/app/search?q=${encodeURIComponent(part)}`}
              className="mention-pill mention-ticker"
              onClick={(e) => e.stopPropagation()}
            >
              ${sym}
            </Link>
          );
        }

        if (/^0x[a-fA-F0-9]{40}$/.test(part)) {
          const lower = part.toLowerCase();
          const match =
            directory.find((t) => t.address.toLowerCase() === lower) ||
            SEEDED_TOKENS.find((t) => t.address.toLowerCase() === lower);
          return (
            <Link
              key={idx}
              to={`/app/token/${lower}`}
              className="mention-pill mention-address"
              title={part}
              onClick={(e) => e.stopPropagation()}
            >
              {match ? `$${match.symbol} (${shortAddr(lower, 5, 3)})` : shortAddr(lower, 6, 4)}
            </Link>
          );
        }

        if (part.startsWith("#") && part.length > 2) {
          return (
            <Link
              key={idx}
              to={`/app/search?q=${encodeURIComponent(part)}`}
              className="mention-pill mention-hashtag"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </Link>
          );
        }

        if (part.startsWith("@") && part.length >= 4) {
          const handle = part.slice(1).toLowerCase();
          return (
            <Link
              key={idx}
              to={`/app/u/${handle}`}
              className="mention-pill mention-user"
              onClick={(e) => e.stopPropagation()}
            >
              @{handle}
            </Link>
          );
        }

        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </span>
  );
}
