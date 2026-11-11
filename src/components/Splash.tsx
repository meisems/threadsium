import React, { useEffect, useRef, useState } from "react";
import { MARK_GEOMETRY as G } from "./brand";
import "./splash.css";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function isEmbed(): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/embed/");
}

/* ───────── splash ─────────
   Logo only: a CRT tube powers on as a single line of light, the Elysium disc lights up, its chevrons
   open out from the apex and the thread drops through them to make the T, then the tube collapses and reveals the page. Plays on the first page load of a browser session,
   whatever page that is (never inside embeds). A tap or click anywhere, or any key, skips it; the
   faint "tap to skip" under the mark is the only hint. */

const SPLASH_KEY = "threadsium-intro-seen";
const SPLASH_HOLD_MS = 2500;
const SPLASH_EXIT_MS = 520;

export function Splash(): React.ReactElement | null {
  const [phase, setPhase] = useState<"on" | "off" | "done">(() => {
    try {
      return isEmbed() || sessionStorage.getItem(SPLASH_KEY) ? "done" : "on";
    } catch {
      return isEmbed() ? "done" : "on";
    }
  });
  const skipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== "on") return;
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      /* private mode: the splash simply plays again next time */
    }
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    skipRef.current?.focus({ preventScroll: true });
    const skip = () => setPhase("off");
    const t = window.setTimeout(skip, prefersReducedMotion() ? 700 : SPLASH_HOLD_MS);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", skip);
      html.style.overflow = prevOverflow;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "off") return;
    const t = window.setTimeout(() => setPhase("done"), prefersReducedMotion() ? 200 : SPLASH_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;
  return (
    <div className={`splash${phase === "off" ? " is-off" : ""}`} onPointerDown={() => setPhase("off")}>
      <div className="splash-tube">
        <span className="splash-beam" aria-hidden="true" />
        <svg className="splash-mark" viewBox="0 0 64 64" fill="none" role="img" aria-label="Threadsium">
          <defs>
            <clipPath id="sp-ring">
              <circle cx="32" cy="32" r={G.ring} />
            </clipPath>
          </defs>
          <circle className="sp-disc" cx="32" cy="32" r="32" />
          <g clipPath="url(#sp-ring)">
            <path className="sp-cut sp-stem" d={G.stem} />
            <path className="sp-gap" d={G.barGap} />
            <path className="sp-cut sp-band sp-bar" d={G.bar} />
            <path className="sp-cut sp-band sp-med" d={G.med} />
            <path className="sp-gap" d={G.medCut} />
            <path className="sp-gap" d={G.smallGap} />
            <path className="sp-cut sp-band sp-small" d={G.small} />
          </g>
        </svg>
        <span className="splash-scan" aria-hidden="true" />
      </div>
      <button ref={skipRef} type="button" className="splash-skip" onClick={() => setPhase("off")}>
        <span className="splash-skip-touch">Tap to skip</span>
        <span className="splash-skip-mouse">Click or press any key to skip</span>
      </button>
    </div>
  );
}
