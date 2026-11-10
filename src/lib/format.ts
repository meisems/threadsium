export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "just now";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fullTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortAddr(addr: string | null | undefined, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function fmtCompact(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  if (abs >= 1) return n.toFixed(digits);
  if (abs === 0) return "0";
  if (abs >= 0.0001) return n.toFixed(4);
  return n.toExponential(2);
}

export function fmtPrice(n: number | null | undefined, prefix = ""): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return `${prefix}${fmtCompact(n, 2)}`;
  if (n >= 1) return `${prefix}${n.toFixed(4)}`;
  if (n >= 0.001) return `${prefix}${n.toFixed(6)}`;
  if (n >= 0.000001) return `${prefix}${n.toFixed(8)}`;
  return `${prefix}${n.toExponential(3)}`;
}

export function extractTextTokens(content: string): {
  tickers: string[];
  addresses: string[];
  hashtags: string[];
} {
  const tickers = new Set<string>();
  const addresses = new Set<string>();
  const hashtags = new Set<string>();

  for (const m of content.matchAll(/\$([A-Za-z][A-Za-z0-9_]{1,11})\b/g)) {
    tickers.add(m[1].toUpperCase());
  }
  for (const m of content.matchAll(/\b(0x[a-fA-F0-9]{40})\b/g)) {
    addresses.add(m[1].toLowerCase());
  }
  for (const m of content.matchAll(/#([A-Za-z0-9_]{2,32})\b/g)) {
    hashtags.add(m[1].toLowerCase());
  }

  return {
    tickers: Array.from(tickers),
    addresses: Array.from(addresses),
    hashtags: Array.from(hashtags),
  };
}
