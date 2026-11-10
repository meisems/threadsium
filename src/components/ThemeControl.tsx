import React, { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "threadsium-theme";

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.getElementById("meta-theme-color")?.setAttribute("content", theme === "light" ? "#E9ECEF" : "#212529");
  document.getElementById("app-favicon")?.setAttribute("href", theme === "light" ? "/favicon-light.svg" : "/favicon-dark.svg");
  window.dispatchEvent(new CustomEvent("threadsium:theme", { detail: theme }));
}

/**
 * Theme control: a sewing button. By day it is a full button with four holes and a cross-stitch;
 * at night a second disc slides across it and leaves a crescent. The page change is a weft wipe
 * that starts at the control (View Transitions), or instant where that is unsupported or motion is reduced.
 */
export function ThemeControl({ compact = false }: { compact?: boolean }): React.ReactElement {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    // Follow the device setting until the person makes their own choice.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        /* storage blocked */
      }
      if (stored === "light" || stored === "dark") return;
      const next: Theme = mq.matches ? "light" : "dark";
      apply(next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: Theme = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
    const commit = () => {
      apply(next);
      setTheme(next);
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (reduce || typeof doc.startViewTransition !== "function") {
      commit();
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const root = document.documentElement;
    root.style.setProperty("--wipe-x", `${Math.round(r.left + r.width / 2)}px`);
    root.classList.add("theme-wipe");
    try {
      const t = doc.startViewTransition(commit) as { finished?: Promise<unknown> };
      Promise.resolve(t?.finished)
        .catch(() => undefined)
        .finally(() => root.classList.remove("theme-wipe"));
    } catch {
      root.classList.remove("theme-wipe");
      commit();
    }
  };

  const night = theme === "dark";
  return (
    <button
      type="button"
      className={`theme-control${compact ? " theme-control-compact" : ""}`}
      onClick={toggle}
      aria-pressed={night}
      aria-label={night ? "Night theme is on. Switch to day theme" : "Day theme is on. Switch to night theme"}
      title={night ? "Switch to day" : "Switch to night"}
    >
      <svg className="theme-button-art" viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <defs>
          <mask id="theme-crescent">
            <rect width="32" height="32" fill="#fff" />
            <circle className="theme-eclipse" cx="22" cy="10" r="10.500" fill="#000" />
          </mask>
        </defs>
        <g mask="url(#theme-crescent)">
          <circle cx="16" cy="16" r="12" className="theme-disc" />
          <circle cx="16" cy="16" r="8.200" className="theme-rim" />
        </g>
        <g className="theme-holes">
          <circle cx="13" cy="13" r="1.500" />
          <circle cx="19" cy="13" r="1.500" />
          <circle cx="13" cy="19" r="1.500" />
          <circle cx="19" cy="19" r="1.500" />
          <path d="M13 13l6 6M19 13l-6 6" className="theme-stitch" />
        </g>
      </svg>
      {compact ? null : <span className="theme-control-label">{night ? "Night" : "Day"}</span>}
    </button>
  );
}
