// Elysium (chain 99901) Launchpad Registry.
// Sourced from verified on-chain PoolCreated / Initialize events and first-party launchpad configs
// (larpsium LAUNCHPAD_REGISTRY & kinepip launchpads.json).
// Never link or fetch elyspump.com (always use https://elyspump.fun).

export type LaunchpadContractRole =
  | "v3-factory"
  | "v4-pool-manager"
  | "v4-hook"
  | "launcher";

export interface LaunchpadContract {
  label: string;
  address: string;
  role: LaunchpadContractRole;
}

export interface LaunchpadTokenInfo {
  address: string;
  symbol: string;
  name: string;
  evidence: string;
  source: string;
}

export interface LaunchpadEntry {
  id: string;
  name: string;
  shortName: string;
  site: string | null;
  status: "live" | "pre-mainnet" | "in development";
  summary: string;
  groups: string[];
  contracts: LaunchpadContract[];
  token: LaunchpadTokenInfo | null;
  tokenUrlPattern?: string | null;
}

export const LAUNCHPAD_REGISTRY: LaunchpadEntry[] = [
  {
    id: "montra",
    name: "Montra",
    shortName: "Montra",
    site: "https://montramarkets.xyz",
    status: "live",
    summary:
      "Prediction-grade V4 token launchpad on the shared Elysium V4 PoolManager with direct live market feeds and bonding/hook liquidity.",
    groups: ["montra"],
    contracts: [
      {
        label: "Montra TokenFactory",
        address: "0x064ad36fb912aa83364ef5f5ed2bb464d6d10356",
        role: "launcher",
      },
      {
        label: "Shared V4 PoolManager",
        address: "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1",
        role: "v4-pool-manager",
      },
      {
        label: "Montra V4 Hook",
        address: "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec",
        role: "v4-hook",
      },
      {
        label: "Montra Router",
        address: "0xc6e9a8e1a99023b67067b8a3605403b8d7b3a157",
        role: "launcher",
      },
    ],
    token: null,
    tokenUrlPattern: "https://montramarkets.xyz/token/{address}",
  },
  {
    id: "kleos",
    name: "Kleos",
    shortName: "Kleos",
    site: "https://www.thekleos.pro",
    status: "live",
    summary:
      "Token launchpad with V3 pools and its own V4 PoolManager, creator fee sharing, and automated buybacks.",
    groups: ["kleos", "kleos-v4"],
    contracts: [
      {
        label: "Kleos Launcher",
        address: "0x6e3afddc9a04debcff1f755421b6067252bf5fa0",
        role: "launcher",
      },
      {
        label: "Kleos V5 Launcher",
        address: "0x893217cb82e1271cd8853f9368186ff2c5eb86c9",
        role: "launcher",
      },
      {
        label: "KleosSwap V3 Factory",
        address: "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1",
        role: "v3-factory",
      },
      {
        label: "Kleos V4 PoolManager",
        address: "0xb308b5df891c300a5f5a5b8fdbc30108ba842490",
        role: "v4-pool-manager",
      },
    ],
    token: {
      address: "0x51c343ed5131f17895991849860b61c2cb0e7e7a",
      symbol: "KLEOS",
      name: "Kleos",
      evidence:
        "Launched through Kleos's launcher at block 18,026 and listed on the Kleos board with description 'The Kleos'.",
      source: "https://www.thekleos.pro/api/board",
    },
    tokenUrlPattern: "https://www.thekleos.pro/token/{address}",
  },
  {
    id: "boxa",
    name: "BOXA",
    shortName: "BOXA",
    site: "https://boxa.club",
    status: "live",
    summary:
      "Multi-version launchpad running V3 factories, its own V4 PoolManager, and a V4 hook on the shared PoolManager with burns & buybacks.",
    groups: ["boxa", "boxa-genesis", "boxa-v4"],
    contracts: [
      {
        label: "BOXA V4 Launcher",
        address: "0x00d4c9043ca4ce55b999923cb4e179129f6ad7b1",
        role: "launcher",
      },
      {
        label: "BOXA V3 Factory",
        address: "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883",
        role: "v3-factory",
      },
      {
        label: "BOXA Genesis V3 Factory",
        address: "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3",
        role: "v3-factory",
      },
      {
        label: "BOXA V4 PoolManager",
        address: "0x06c63714fbf1f5753017123e2fcfdede4540b2c4",
        role: "v4-pool-manager",
      },
      {
        label: "BOXA V4 Hook (shared PM)",
        address: "0x00c002cdcd5894f632e1d5ebceaa3d8bf8b02ac0",
        role: "v4-hook",
      },
    ],
    token: {
      address: "0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
      symbol: "BOXA",
      name: "BOXA",
      evidence:
        "Launched through BOXA's V4 launcher at block 18,342 and listed on boxa.club/api/tokens.",
      source:
        "https://boxa.club/api/token/0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7",
    },
    tokenUrlPattern: "https://boxa.club/asset?address={address}",
  },
  {
    id: "elyxa",
    name: "ELYXA",
    shortName: "ELYXA",
    site: "https://elyxa.trade",
    status: "live",
    summary:
      "Trading terminal and V4 launchpad with its own PoolManager and the Synapse hook on the shared PoolManager.",
    groups: ["elyxa-v4"],
    contracts: [
      {
        label: "ELYXA Launcher",
        address: "0x1cb9e909fb57f4fd77faacbd59a4b7dc087f1e88",
        role: "launcher",
      },
      {
        label: "ELYXA V4 PoolManager",
        address: "0x3564d7defdb26abe3f0953ee57d93953ec94fa25",
        role: "v4-pool-manager",
      },
      {
        label: "Synapse V4 Hook (shared PM)",
        address: "0xe20830b3235020edab257deff9d7b1ff2230f3fd",
        role: "v4-hook",
      },
    ],
    token: {
      address: "0xbd61e339a53fe9a27b8dba6dfdb63f443cbec077",
      symbol: "ELYXA",
      name: "ELYXA",
      evidence:
        "Named as officialToken in elyxa.trade/api/config and pinned first in the ELYXA pair feed.",
      source: "https://elyxa.trade/api/config",
    },
    tokenUrlPattern: "https://elyxa.trade/token/{address}",
  },
  {
    id: "obol",
    name: "Obol",
    shortName: "Obol",
    site: "https://tradeobol.world",
    status: "live",
    summary:
      "Multi-quote V4 launchpad deploying single-sided pools on the shared PoolManager via Obol hooks.",
    groups: ["obol"],
    contracts: [
      {
        label: "ObolPad",
        address: "0xfee823bea01c0268cf159f2c8d8ed15fc3fd4f3a",
        role: "launcher",
      },
      {
        label: "ObolPad v2",
        address: "0x4de079025f6d73c933a2ec1a114ad0f73493a757",
        role: "launcher",
      },
      {
        label: "Obol V4 Hook",
        address: "0xd0963775be47fb5bc76c7e22c5ca5e2de3e93ac0",
        role: "v4-hook",
      },
      {
        label: "Obol V4 Hook v2",
        address: "0x76d61518d718fb7d2fd6b73fb1da04e5dc077ac0",
        role: "v4-hook",
      },
    ],
    token: {
      address: "0xdc34b3a34a3f84998d2aaea9c31c9c86318b5b51",
      symbol: "OBOL",
      name: "Obol",
      evidence:
        "Listed as the OBOL quote currency in Obol's own config (tradeobol.world/api/config).",
      source: "https://tradeobol.world/api/config",
    },
    tokenUrlPattern: "https://tradeobol.world/token/{address}",
  },
  {
    id: "eleos",
    name: "Eleos",
    shortName: "Eleos",
    site: "https://eleos.fun",
    status: "live",
    summary:
      "One-transaction V4 launchpad with its own PoolManager and HYPE holder rewards.",
    groups: ["eleos-v4"],
    contracts: [
      {
        label: "Eleos V4 PoolManager",
        address: "0x5c54a7293d96b11a29a0256ee8dfdbc3059637da",
        role: "v4-pool-manager",
      },
      {
        label: "Eleos V4 Hook",
        address: "0x86809655c1df48ad72e45f40986eb62f7848fac8",
        role: "v4-hook",
      },
      {
        label: "Eleos Launcher",
        address: "0x9c73d1792eb5da9c1a1622a4068e4d7e08f3d9f2",
        role: "launcher",
      },
    ],
    token: {
      address: "0x20e35aa83473acbc736fd178550845c640b8ce0d",
      symbol: "EOS",
      name: "Eleos",
      evidence: "Named as platformToken in eleos.fun's page config.",
      source: "https://eleos.fun",
    },
    tokenUrlPattern: "https://eleos.fun/token/{address}",
  },
  {
    id: "volta",
    name: "Volta",
    shortName: "Volta",
    site: "https://www.volta.family",
    status: "live",
    summary:
      "Uniswap V4 hook launchpad deploying pools on the shared V4 PoolManager.",
    groups: ["volta"],
    contracts: [
      {
        label: "Volta V4 Hook (shared PM)",
        address: "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc",
        role: "v4-hook",
      },
    ],
    token: {
      address: "0x0f79931689af199e7cf868ed1107bba2c83c68f7",
      symbol: "VOLTA",
      name: "Volta",
      evidence:
        "First token initialized with Volta's V4 hook on the shared PoolManager (block 18,325).",
      source: "https://www.volta.family",
    },
    tokenUrlPattern: "https://www.volta.family",
  },
  {
    id: "ronspad",
    name: "Ronspad",
    shortName: "Ronspad",
    site: "https://ronspad.fun",
    status: "live",
    summary: "V3 launchpad and bridge with single-sided WHYPE pools.",
    groups: ["ronspad"],
    contracts: [
      {
        label: "Ronspad V3 Factory",
        address: "0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f",
        role: "v3-factory",
      },
      {
        label: "Ronspad PadFactory",
        address: "0x371811b016df511284a459401f536fa5092d1cd9",
        role: "launcher",
      },
    ],
    token: {
      address: "0x44d13223e2024c6f3f957d5c9ab98f8a550061f3",
      symbol: "RONS",
      name: "Ronspad",
      evidence: "Named as RONS on ronspad.fun/developers.",
      source: "https://ronspad.fun/developers",
    },
    tokenUrlPattern: "https://ronspad.fun/token/{address}",
  },
  {
    id: "elyspump",
    name: "ElysPump",
    shortName: "ElysPump",
    site: "https://elyspump.fun",
    status: "live",
    summary: "Token launchpad with V3 pools and its own V4 PoolManager.",
    groups: ["elyspump-v3", "elyspump-v4"],
    contracts: [
      {
        label: "ElysPump Launcher",
        address: "0xe11cafa5d2ca57f902a60b67d75be6cd5292d197",
        role: "launcher",
      },
      {
        label: "ElysPump V3 Factory",
        address: "0x367f85886af509e364c8190862bc714555fefc3e",
        role: "v3-factory",
      },
      {
        label: "ElysPump V4 PoolManager",
        address: "0x5fb015a49f5b35073f9ce01c2adb287a75f89600",
        role: "v4-pool-manager",
      },
    ],
    token: null,
    tokenUrlPattern: "https://elyspump.fun/#/token/{address}",
  },
  {
    id: "chainzy",
    name: "Chainzy",
    shortName: "Chainzy",
    site: "https://chainzy.io",
    status: "live",
    summary: "V3 DEX and token launchpad with two factory deployments on Elysium.",
    groups: ["chainzy", "chainzy-v2"],
    contracts: [
      {
        label: "Chainzy V3 Factory",
        address: "0x4f6cf2793119141c886544a4bca617ec906635b1",
        role: "v3-factory",
      },
      {
        label: "Chainzy V3 v2 Factory",
        address: "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615",
        role: "v3-factory",
      },
    ],
    token: null,
    tokenUrlPattern: "https://chainzy.io/elysium/trade/{address}",
  },
  {
    id: "stockium",
    name: "Stockium",
    shortName: "Stockium",
    site: "https://stockium.fun",
    status: "live",
    summary: "Memecoin launchpad and V3 DEX (StockiumSwap).",
    groups: ["stockium"],
    contracts: [
      {
        label: "StockiumSwap V3 Factory",
        address: "0x9197bfaa11a76f628ba4c5efbe4e3f6e4ca48009",
        role: "v3-factory",
      },
    ],
    token: null,
    tokenUrlPattern: "https://stockium.fun/token/{address}",
  },
  {
    id: "olympad",
    name: "Olympad",
    shortName: "Olympad",
    site: "https://olympad.fun",
    status: "live",
    summary: "One-click V3 token launchpad with instant LP.",
    groups: ["olympad"],
    contracts: [
      {
        label: "Olympad Launcher",
        address: "0x55c7fcc02179b0b50126c1d318d99e2d243ef4d3",
        role: "launcher",
      },
      {
        label: "Olympad V3 Factory",
        address: "0x3f8dde9d2a179a8c1272033368e0f22d63e340ec",
        role: "v3-factory",
      },
    ],
    token: null,
    tokenUrlPattern: "https://olympad.fun",
  },
  {
    id: "hookium",
    name: "Hookium",
    shortName: "Hookium",
    site: "https://hookium.fun",
    status: "live",
    summary: "Uniswap V4 launchpad with anti-dump hooks and creator vaults.",
    groups: ["hookium"],
    contracts: [],
    token: null,
    tokenUrlPattern: "https://hookium.fun",
  },
  {
    id: "perpme",
    name: "PerpMe",
    shortName: "PerpMe",
    site: "https://perpme.fun/elysium",
    status: "live",
    summary:
      "Spot & perps DEX deploying a V4 hook on the shared PoolManager and PerpFactory contracts.",
    groups: ["perpme"],
    contracts: [
      {
        label: "PerpMe V4 Hook (shared PM)",
        address: "0xb67656ce5b3324fc6a7914483a71a79e3bb27f8c",
        role: "v4-hook",
      },
      {
        label: "PerpFactory v2",
        address: "0xe35b622b262135a43269c3fb3e2c44bb9bc58cb7",
        role: "launcher",
      },
      {
        label: "PerpFactory v1",
        address: "0xa338c80bf17f53b73fc84829aa89378683dc3fa3",
        role: "launcher",
      },
      {
        label: "PerpFactory v0",
        address: "0x682dc045dc210248bcfa1c2ef137ba1c23915d87",
        role: "launcher",
      },
    ],
    token: null,
    tokenUrlPattern: "https://perpme.fun/elysium",
  },
  {
    id: "supercolony",
    name: "Supercolony",
    shortName: "Supercolony",
    site: null,
    status: "live",
    summary: "On-chain V3 launchpad factory indexed by ELYXA.",
    groups: ["supercolony"],
    contracts: [
      {
        label: "Supercolony V3 Factory",
        address: "0x9f9169a859a940882452449db0f041c426d907b6",
        role: "v3-factory",
      },
    ],
    token: null,
  },
  {
    id: "mesa",
    name: "Mesa",
    shortName: "Mesa",
    site: "https://mesa.cx",
    status: "live",
    summary: "One-click V3 token launchpad with single-sided WHYPE pools.",
    groups: ["mesa"],
    contracts: [
      {
        label: "Mesa Launcher",
        address: "0xe928f233f48c0a8b8fc6d6fbdb5d05a846ff9f2b",
        role: "launcher",
      },
    ],
    token: null,
    tokenUrlPattern: "https://mesa.cx",
  },
  {
    id: "hesperia",
    name: "Hesperia",
    shortName: "Hesperia",
    site: "https://www.hesperia.trade",
    status: "live",
    summary: "Token launchpad on Uniswap V3 (factory 1707).",
    groups: ["hesperia"],
    contracts: [
      {
        label: "Hesperia Launcher",
        address: "0xe1dec38ac76e0d2bc327c32c8b02348241d2e8ac",
        role: "launcher",
      },
    ],
    token: null,
    tokenUrlPattern: "https://www.hesperia.trade",
  },
  {
    id: "ascend",
    name: "Ascend",
    shortName: "Ascend",
    site: "https://ascendlaunch.xyz",
    status: "live",
    summary: "Milestone-gated token launchpad with investor protection.",
    groups: ["ascend"],
    contracts: [
      {
        label: "Ascend LaunchpadFactory",
        address: "0x63f6a8a8e3b00dc2f6a1bd4dbca4ca896959dc98",
        role: "launcher",
      },
    ],
    token: null,
    tokenUrlPattern: "https://ascendlaunch.xyz",
  },
  {
    id: "elyspad",
    name: "ElysPad",
    shortName: "ElysPad",
    site: "https://elysium.unipad.club",
    status: "pre-mainnet",
    summary: "UniPad deployment on Elysium (pre-mainnet demo).",
    groups: [],
    contracts: [],
    token: null,
  },
  {
    id: "altl2",
    name: "ALT L2",
    shortName: "ALT L2",
    site: "https://altl2.fun",
    status: "in development",
    summary: "Launchpad site on Elysium currently under construction.",
    groups: [],
    contracts: [],
    token: null,
  },
];

// Fast lookup maps built once on module load
const BY_ID = new Map<string, LaunchpadEntry>();
const BY_NAME = new Map<string, LaunchpadEntry>();
const BY_GROUP = new Map<string, LaunchpadEntry>();
const BY_HOOK = new Map<string, LaunchpadEntry>();
const BY_FACTORY = new Map<string, LaunchpadEntry>();
const BY_TOKEN = new Map<string, LaunchpadEntry>();

for (const lp of LAUNCHPAD_REGISTRY) {
  BY_ID.set(lp.id.toLowerCase(), lp);
  BY_NAME.set(lp.name.toLowerCase(), lp);
  BY_NAME.set(lp.shortName.toLowerCase(), lp);
  for (const g of lp.groups) {
    BY_GROUP.set(g.toLowerCase(), lp);
  }
  for (const c of lp.contracts) {
    const addr = c.address.toLowerCase();
    if (c.role === "v4-hook") BY_HOOK.set(addr, lp);
    if (c.role === "v3-factory" || c.role === "v4-pool-manager" || c.role === "launcher") {
      BY_FACTORY.set(addr, lp);
    }
  }
  if (lp.token) {
    BY_TOKEN.set(lp.token.address.toLowerCase(), lp);
  }
}

export function launchpadById(idOrName: string | null | undefined): LaunchpadEntry | null {
  if (!idOrName) return null;
  const k = idOrName.trim().toLowerCase();
  return BY_ID.get(k) ?? BY_NAME.get(k) ?? BY_GROUP.get(k) ?? null;
}

/**
 * Attribute a pool or pair to a launchpad by venue group, V4 hook, or factory/launcher address.
 */
export function launchpadOfPool(
  group?: string | null,
  hooks?: string | null,
  factory?: string | null
): LaunchpadEntry | null {
  if (hooks) {
    const byHook = BY_HOOK.get(hooks.toLowerCase());
    if (byHook) return byHook;
  }
  if (group) {
    const g = group.trim().toLowerCase();
    const byGroup = BY_GROUP.get(g) ?? BY_ID.get(g) ?? BY_NAME.get(g);
    if (byGroup) return byGroup;
  }
  if (factory) {
    const byFactory = BY_FACTORY.get(factory.toLowerCase());
    if (byFactory) return byFactory;
  }
  return null;
}

/**
 * If `address` is a launchpad's official platform token, return that launchpad entry.
 */
export function launchpadTokenOf(address: string | null | undefined): LaunchpadEntry | null {
  if (!address) return null;
  return BY_TOKEN.get(address.toLowerCase()) ?? null;
}

/**
 * Build a direct link to the token page on its origin launchpad, if supported.
 */
export function launchpadTokenPage(
  launchpadIdOrName: string | null | undefined,
  tokenAddress: string
): { name: string; url: string; id: string } | null {
  const addr = tokenAddress.toLowerCase();
  const lp = launchpadById(launchpadIdOrName) ?? launchpadTokenOf(addr);
  if (!lp || !lp.site) return null;
  if (lp.tokenUrlPattern) {
    return {
      id: lp.id,
      name: lp.name,
      url: lp.tokenUrlPattern.replace("{address}", addr),
    };
  }
  return {
    id: lp.id,
    name: lp.name,
    url: lp.site,
  };
}

/**
 * Build all verified Elysium trade links for a token (origin launchpad + ecosystem DEXes).
 */
export function tradeLinksForToken(
  tokenAddress: string,
  launchpadIdOrName?: string | null
): Array<{ label: string; url: string; primary?: boolean }> {
  const addr = tokenAddress.toLowerCase();
  const links: Array<{ label: string; url: string; primary?: boolean }> = [];
  const seen = new Set<string>();

  const add = (label: string, url: string, primary = false) => {
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url, primary });
  };

  const lpPage = launchpadTokenPage(launchpadIdOrName, addr);
  if (lpPage) {
    add(lpPage.name, lpPage.url, true);
  }

  add("ELYXA", `https://elyxa.trade/token/${addr}`);
  add("Chainzy", `https://chainzy.io/elysium/trade/${addr}`);
  add("AgoraDex", `https://www.agoradex.io/swap?buy=${addr}`);

  return links;
}

const SKIP_ICON = /favicon\.ico(\?|$)|\.svg(\?|$)/i;

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? m[1].trim() : null;
}

/**
 * Extract raster icon URLs declared in a launchpad page's <head>, ordered by quality:
 * apple-touch-icon first, then raster <link rel="icon">, then og:image.
 * Skips .ico and .svg URLs so the wsrv.nl resizer always gets a raster image.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const head = html.slice(0, 64_000);
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const touch: string[] = [];
  const icons: string[] = [];

  const resolve = (href: string | null): string | null => {
    if (!href || SKIP_ICON.test(href) || href.startsWith("data:")) return null;
    try {
      const u = new URL(href, pageUrl);
      return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
    } catch {
      return null;
    }
  };

  for (const tag of links) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = resolve(attr(tag, "href"));
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) touch.push(href);
    else if (/\bicon\b/.test(rel)) icons.push(href);
  }

  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const og: string[] = [];
  for (const tag of metas) {
    const prop = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (prop === "og:image" || prop === "twitter:image") {
      const content = resolve(attr(tag, "content"));
      if (content) og.push(content);
    }
  }

  return [...new Set([...touch, ...icons, ...og])];
}
