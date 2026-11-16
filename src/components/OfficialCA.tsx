import React, { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { explorerToken } from "../config/chain";
import { OFFICIAL_TOKEN } from "../config/official";
import { IconCheck, IconCopy, IconExternal } from "./icons";

/**
 * The official THREADSIUM contract address, shown in full with a copy button, a link to its room and a link to
 * the explorer. Used on the landing page, the right rail and the docs so the CA reads the same everywhere.
 */
export function OfficialCA({ className = "", note = true }: { className?: string; note?: boolean }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const addrRef = useRef<HTMLElement | null>(null);
  const labelId = useId();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(OFFICIAL_TOKEN.address);
    } catch {
      // Clipboard blocked: select the address so it can be copied by hand.
      const el = addrRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className={`official-ca ${className}`.trim()} aria-labelledby={labelId}>
      <p className="official-ca-label" id={labelId}>
        <span className="official-ca-tag">Official CA</span> ${OFFICIAL_TOKEN.symbol} · Elysium 99901
      </p>
      <div className="official-ca-row">
        <code ref={addrRef} className="official-ca-addr" translate="no">
          {OFFICIAL_TOKEN.address}
        </code>
        <button type="button" className="official-ca-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy contract address"}>
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <p className="official-ca-links">
        <Link to={`/app/token/${OFFICIAL_TOKEN.address}`}>Room and chart</Link>
        <a href={explorerToken(OFFICIAL_TOKEN.address)} target="_blank" rel="noopener noreferrer">
          Explorer <IconExternal size={12} />
        </a>
      </p>
      {note ? <p className="official-ca-note">This is the only official THREADSIUM contract. Check the address before you buy; Threadsium never DMs you a different one.</p> : null}
    </section>
  );
}
