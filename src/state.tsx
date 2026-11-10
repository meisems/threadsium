import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SEEDED_TOKENS } from "./config/tokens";
import { api, type Me, type Post, type RoomToken } from "./lib/api";
import { rpcRequest } from "./lib/rpc";

export interface ComposeOptions {
  quote?: Post;
  room?: { address: string; symbol: string } | null;
  text?: string;
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

interface AppState {
  user: Me | null;
  /** False until the first session check has answered. */
  sessionReady: boolean;
  setUser: (u: Me | null) => void;
  signOut: () => Promise<void>;
  tokens: RoomToken[];
  /** True once the live directory replaced the built-in verified list. */
  tokensLive: boolean;
  tokenByAddress: (address: string | null | undefined) => RoomToken | null;
  tokenBySymbol: (symbol: string) => RoomToken | null;
  hypeUsd: number | null;
  block: number | null;
  counts: { notifications: number; messages: number };
  refreshCounts: () => void;
  toast: (text: string, tone?: "ok" | "error") => void;
  compose: (opts?: ComposeOptions) => void;
  composing: ComposeOptions | null;
  closeComposer: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

/* Feed pages listen here so a new, edited or deleted post shows up without a refetch. */
type PostEvent = { type: "created"; post: Post } | { type: "updated"; post: Post } | { type: "deleted"; id: string };
const listeners = new Set<(e: PostEvent) => void>();
export const postBus = {
  emit(e: PostEvent) {
    listeners.forEach((l) => l(e));
  },
  on(l: (e: PostEvent) => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

const BUILT_IN: RoomToken[] = SEEDED_TOKENS.map((s) => ({
  address: s.address.toLowerCase(),
  symbol: s.symbol,
  name: s.name,
  launchpad: s.launchpad,
  launchpadId: s.launchpadId,
  launchpadUrl: s.launchpadUrl,
  venueBadge: s.venueBadge,
  description: s.description,
  featured: s.featured,
  isLaunchpadToken: s.isLaunchpadToken,
  hypeDepth: 0,
  recentSwaps: 0,
  sources: [s.launchpadId],
  commentCount: 0,
  bullishCount: 0,
  bearishCount: 0,
  avgRating: 0,
  ratingCount: 0,
}));

function whenVisible(fn: () => void, everyMs: number): () => void {
  const tick = () => {
    if (document.visibilityState === "visible") fn();
  };
  const id = window.setInterval(tick, everyMs);
  document.addEventListener("visibilitychange", tick);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", tick);
  };
}

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUserState] = useState<Me | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [tokens, setTokens] = useState<RoomToken[]>(BUILT_IN);
  const [tokensLive, setTokensLive] = useState(false);
  const [hypeUsd, setHypeUsd] = useState<number | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [counts, setCounts] = useState({ notifications: 0, messages: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [composing, setComposing] = useState<ComposeOptions | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3200);
  }, []);

  const setUser = useCallback((u: Me | null) => {
    setUserState(u);
    if (!u) setCounts({ notifications: 0, messages: 0 });
  }, []);

  const refreshCounts = useCallback(() => {
    api
      .counts()
      .then(setCounts)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(setUserState)
      .catch(() => undefined)
      .finally(() => setSessionReady(true));

    const loadTokens = () =>
      api
        .tokens()
        .then((r) => {
          if (r.tokens.length) {
            setTokens(r.tokens.map((t) => ({ ...t, address: t.address.toLowerCase() })));
            setTokensLive(true);
          }
        })
        .catch(() => undefined);
    const loadPrice = () =>
      api
        .price()
        .then((r) => setHypeUsd(r.hypeUsd && r.hypeUsd > 0 ? r.hypeUsd : null))
        .catch(() => undefined);
    const loadBlock = () =>
      rpcRequest<string>("eth_blockNumber", [])
        .then((hex) => {
          const n = parseInt(hex, 16);
          if (Number.isFinite(n)) setBlock(n);
        })
        .catch(() => undefined);

    loadTokens();
    loadPrice();
    loadBlock();
    const stops = [whenVisible(loadTokens, 120_000), whenVisible(loadPrice, 60_000), whenVisible(loadBlock, 20_000)];
    return () => stops.forEach((s) => s());
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshCounts();
    return whenVisible(refreshCounts, 60_000);
  }, [user?.id, refreshCounts]);

  const byAddress = useMemo(() => new Map(tokens.map((t) => [t.address, t])), [tokens]);
  const bySymbol = useMemo(() => {
    // When two contracts share a ticker, the verified one wins, then the deeper pool.
    const m = new Map<string, RoomToken>();
    for (const t of tokens) {
      const k = t.symbol.toUpperCase();
      const cur = m.get(k);
      if (!cur || (t.featured && !cur.featured) || (t.featured === cur.featured && t.hypeDepth > cur.hypeDepth)) m.set(k, t);
    }
    return m;
  }, [tokens]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the local session is cleared either way */
    }
    setUser(null);
  }, [setUser]);

  const value: AppState = {
    user,
    sessionReady,
    setUser,
    signOut,
    tokens,
    tokensLive,
    tokenByAddress: (a) => (a ? byAddress.get(a.toLowerCase()) ?? null : null),
    tokenBySymbol: (s) => bySymbol.get(s.replace(/^\$/, "").toUpperCase()) ?? null,
    hypeUsd,
    block,
    counts,
    refreshCounts,
    toast,
    compose: (opts) => setComposing(opts ?? {}),
    composing,
    closeComposer: () => setComposing(null),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
