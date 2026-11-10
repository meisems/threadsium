// Seeded flagship & verified launchpad tokens on Elysium 99901.
// Sourced from first-party launchpad configs and verified on-chain records (larpsium LAUNCHPAD_REGISTRY & poolsium CURATED).
// No unverified copycat contracts are included here.

export interface SeededToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  launchpad: string;
  launchpadUrl: string;
  venueBadge: string;
  description: string;
  tagline: string;
  featured: boolean;
}

export const SEEDED_TOKENS: SeededToken[] = [
  {
    address: "0xe45a355d9e9cad2ad85f2d03e3ee3102a036acf0",
    symbol: "KNTQ",
    name: "Kinetiq",
    decimals: 18,
    launchpad: "Kinetiq",
    launchpadUrl: "https://kinetiq.xyz",
    venueBadge: "BOXA V3 · Stockium · V4",
    description:
      "Kinetiq Governance Token on Elysium 99901, traded across BOXA V3, StockiumSwap, and Uniswap V4 pools.",
    tagline:
      "Kinetiq Governance Token on Elysium 99901, traded across BOXA V3, StockiumSwap, and Uniswap V4 pools.",
    featured: true,
  },
  {
    address: "0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
    symbol: "BOXA",
    name: "BOXA",
    decimals: 18,
    launchpad: "BOXA",
    launchpadUrl: "https://boxa.club",
    venueBadge: "BOXA V4",
    description:
      "Launched through BOXA's V4 launcher and listed on boxa.club with V3/V4 launchpads, burns, and buybacks.",
    tagline:
      "Launched through BOXA's V4 launcher and listed on boxa.club with V3/V4 launchpads, burns, and buybacks.",
    featured: true,
  },
  {
    address: "0x51c343ed5131f17895991849860b61c2cb0e7e7a",
    symbol: "KLEOS",
    name: "Kleos",
    decimals: 18,
    launchpad: "Kleos",
    launchpadUrl: "https://www.thekleos.pro",
    venueBadge: "KleosSwap V3 · Kleos V4",
    description:
      "Launched through Kleos's launcher at block 18,026 and listed on the Kleos board with creator fee & buyback mechanics.",
    tagline:
      "Launched through Kleos's launcher at block 18,026 and listed on the Kleos board with creator fee & buyback mechanics.",
    featured: true,
  },
  {
    address: "0xbd61e339a53fe9a27b8dba6dfdb63f443cbec077",
    symbol: "ELYXA",
    name: "ELYXA",
    decimals: 18,
    launchpad: "ELYXA",
    launchpadUrl: "https://elyxa.trade",
    venueBadge: "ELYXA V4 · Synapse",
    description:
      "Named as officialToken in ELYXA's terminal config. Powers the ELYXA trading terminal and Synapse hook ecosystem.",
    tagline:
      "Named as officialToken in ELYXA's terminal config. Powers the ELYXA trading terminal and Synapse hook ecosystem.",
    featured: true,
  },
  {
    address: "0xdc34b3a34a3f84998d2aaea9c31c9c86318b5b51",
    symbol: "OBOL",
    name: "Obol",
    decimals: 18,
    launchpad: "Obol",
    launchpadUrl: "https://tradeobol.world",
    venueBadge: "Obol Pad · V4",
    description:
      "Listed as the OBOL quote currency in Obol's own config (tradeobol.world/api/config) for multi-quote launches.",
    tagline:
      "Listed as the OBOL quote currency in Obol's own config (tradeobol.world/api/config) for multi-quote launches.",
    featured: true,
  },
  {
    address: "0x20e35aa83473acbc736fd178550845c640b8ce0d",
    symbol: "EOS",
    name: "Eleos",
    decimals: 18,
    launchpad: "Eleos",
    launchpadUrl: "https://eleos.fun",
    venueBadge: "Eleos V4",
    description:
      "Named as platformToken in eleos.fun's page config for one-tx V4 launches with HYPE holder rewards.",
    tagline:
      "Named as platformToken in eleos.fun's page config for one-tx V4 launches with HYPE holder rewards.",
    featured: false,
  },
  {
    address: "0x44d13223e2024c6f3f957d5c9ab98f8a550061f3",
    symbol: "RONS",
    name: "Ronspad",
    decimals: 18,
    launchpad: "Ronspad",
    launchpadUrl: "https://ronspad.fun",
    venueBadge: "Ronspad V3",
    description:
      "Named as RONS on ronspad.fun/developers for Ronspad's V3 launchpad and bridge ecosystem.",
    tagline:
      "Named as RONS on ronspad.fun/developers for Ronspad's V3 launchpad and bridge ecosystem.",
    featured: false,
  },
];

export function findSeededToken(addressOrSymbol: string): SeededToken | null {
  const q = addressOrSymbol.trim().replace(/^\$/, "").toLowerCase();
  return (
    SEEDED_TOKENS.find(
      (t) =>
        t.address.toLowerCase() === q || t.symbol.toLowerCase() === q
    ) ?? null
  );
}
