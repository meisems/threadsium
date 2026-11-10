import React, { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "threadsium-theme";

function readInitialTheme(): ThemeMode {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore storage errors
  }
  return "dark";
}

function applyThemeToDom(next: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  const meta = document.getElementById("meta-theme-color");
  if (meta) {
    meta.setAttribute("content", next === "light" ? "#F7F4EC" : "#0A0D0C");
  }
  const icon = document.getElementById("app-favicon");
  if (icon) {
    icon.setAttribute(
      "href",
      next === "light" ? "/favicon-light.svg" : "/favicon-dark.svg"
    );
  }
  window.dispatchEvent(new CustomEvent("threadsium-theme-change", { detail: next }));
}

export function ThemeControl(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    const onSync = (e: Event) => {
      const custom = e as CustomEvent<ThemeMode>;
      if (custom.detail === "light" || custom.detail === "dark") {
        setTheme(custom.detail);
      }
    };
    window.addEventListener("threadsium-theme-change", onSync);
    return () => window.removeEventListener("threadsium-theme-change", onSync);
  }, []);

  const toggleTheme = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const docAny = document as any;
    if (typeof docAny.startViewTransition === "function" && !prefersReducedMotion) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y)
      );
      const transition = docAny.startViewTransition(() => {
        applyThemeToDom(next);
        setTheme(next);
      });
      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${maxRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 280,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)",
            }
          );
        })
        .catch(() => {});
    } else {
      applyThemeToDom(next);
      setTheme(next);
    }
  };

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-shuttle-btn"
      aria-label={`Switch to ${isLight ? "dark" : "light"} theme (currently ${theme})`}
      aria-pressed={isLight}
      title={`Theme: ${isLight ? "Dayloom (Light)" : "Nightloom (Dark)"}`}
    >
      <span className="theme-shuttle-track" aria-hidden="true">
        <span
          className={`theme-shuttle-thumb ${
            isLight ? "is-light" : "is-dark"
          }`}
        >
          {isLight ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="5" fill="currentColor" />
              <path
                d="M12 2V5M12 19V22M2 12H5M19 12H22M4.93 4.93L7.05 7.05M16.95 16.95L19.07 19.07M19.07 4.93L16.95 7.05M7.05 16.95L4.93 19.07"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z"
                fill="currentColor"
              />
            </svg>
          )}
        </span>
      </span>
      <span className="theme-shuttle-label">
        {isLight ? "Dayloom" : "Nightloom"}
      </span>
    </button>
  );
}
