// Elysium (chain 99901) Launchpad Registry.
//
// Every contract address below was checked on chain 99901 (eth_getCode + event logs) in November 2026,
// and matched to its launchpad through that launchpad's own site bundle or its own token feed.
// `launchSources` drive the worker's on-chain launch index (worker/launchIndex.ts): each source names the
// contract that emits the event marking a new launch, the event, and the block to start scanning from.
// To track one more launchpad, add an entry with its launch sources; nothing else needs to change.
//
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

/** On-chain events that mark a new token launch. */
export type LaunchEventKind = "v4-initialize" | "v3-pool-created";

export interface LaunchEventSpec {
  /** Canonical event signature; topic0 = keccak256(signature). */
  signature: string;
  topic0: string;
  /** Human-readable ABI fragment. */
  abi: string;
}

export const LAUNCH_EVENTS: Record<LaunchEventKind, LaunchEventSpec> = {
  "v4-initialize": {
    signature: "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
    topic0: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
    abi: "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  },
  "v3-pool-created": {
    signature: "PoolCreated(address,address,uint24,int24,address)",
    topic0: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
    abi: "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
  },
};

export interface LaunchSource {
  label: string;
  event: LaunchEventKind;
  /** Contract that emits the launch event: a V4 PoolManager or a V3 factory. */
  emitter: string;
  /** v4-initialize only: the PoolKey hook that marks this launchpad's pools on `emitter`. */
  hook?: string;
  /** First block worth scanning (at or before the first launch). */
  startBlock: number;
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
  /** Events that mark a launch on this launchpad. Empty means no launch contract could be verified on-chain. */
  launchSources: LaunchSource[];
  /** Launchpad key in BOXA's all-token index (boxa.club/api/index/tokens?launchpad=), when it has one. */
  boxaIndexKey?: string;
  token: LaunchpadTokenInfo | null;
  tokenUrlPattern?: string | null;
}

/** Shared Elysium V4 PoolManager and the launchpad-owned PoolManagers. */
export const POOL_MANAGERS = {
  shared: "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1",
  boxa: "0x06c63714fbf1f5753017123e2fcfdede4540b2c4",
  kleos: "0xb308b5df891c300a5f5a5b8fdbc30108ba842490",
  elyspump: "0x5fb015a49f5b35073f9ce01c2adb287a75f89600",
  elyxa: "0x3564d7defdb26abe3f0953ee57d93953ec94fa25",
  eleos: "0x5c54a7293d96b11a29a0256ee8dfdbc3059637da",
} as const;

const v4 = (label: string, emitter: string, hook: string, startBlock: number): LaunchSource => ({
  label,
  event: "v4-initialize",
  emitter,
  hook,
  startBlock,
});

const v3 = (label: string, factory: string, startBlock: number): LaunchSource => ({
  label,
  event: "v3-pool-created",
  emitter: factory,
  startBlock,
});

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
      { label: "Shared V4 PoolManager", address: POOL_MANAGERS.shared, role: "v4-pool-manager" },
      { label: "Montra V4 Hook", address: "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec", role: "v4-hook" },
      { label: "Montra Pool Launcher", address: "0x38d3ef3a06d18fa3286fb5deafe611be725fcd15", role: "launcher" },
      { label: "Montra Router", address: "0xc6e9a8e1a99023b67067b8a3605403b8d7b3a157", role: "launcher" },
    ],
    launchSources: [v4("Montra hook pools", POOL_MANAGERS.shared, "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec", 637_000)],
    boxaIndexKey: "montra",
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
      { label: "Kleos Launcher", address: "0x6e3afddc49f5d43858a1fdd48184426ded11029b", role: "launcher" },
      { label: "Kleos V4 Launcher", address: "0x2da68edff4588a77b55a829689c382f2acb39502", role: "launcher" },
      { label: "Kleos V5 Launcher", address: "0x893217cbf5c054fd6ee56893b313a4b98c4403e4", role: "launcher" },
      { label: "KleosSwap V3 Factory", address: "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1", role: "v3-factory" },
      { label: "Kleos V4 PoolManager", address: POOL_MANAGERS.kleos, role: "v4-pool-manager" },
      { label: "Kleos V4 Hook", address: "0xd5068e7f4e2d70d5efbac6fd28a8407252e1eacc", role: "v4-hook" },
      { label: "Kleos V5 Hook", address: "0x0c835e6a51717a514144d95c7f0a1c640179e0cc", role: "v4-hook" },
      { label: "Kleos KLEOS-pair Hook", address: "0x772accb053609d361593345e361d2a6854ede8cc", role: "v4-hook" },
      { label: "Kleos Hook (shared PM)", address: "0x0fa71294c909b11a0b805df4763ba576c69c2acc", role: "v4-hook" },
    ],
    launchSources: [
      v3("KleosSwap V3 pools", "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1", 8_000),
      v4("Kleos V5 hook pools", POOL_MANAGERS.kleos, "0x0c835e6a51717a514144d95c7f0a1c640179e0cc", 24_000),
      v4("Kleos KLEOS-pair hook pools", POOL_MANAGERS.kleos, "0x772accb053609d361593345e361d2a6854ede8cc", 99_000),
      v4("Kleos V4 hook pools", POOL_MANAGERS.kleos, "0xd5068e7f4e2d70d5efbac6fd28a8407252e1eacc", 180_000),
      v4("Kleos shared-PM hook pools", POOL_MANAGERS.shared, "0x0fa71294c909b11a0b805df4763ba576c69c2acc", 433_000),
    ],
    boxaIndexKey: "kleos",
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
      { label: "BOXA V4 Launcher", address: "0x00d4c904f74f74c6920c95e3ee807ab3c52dd205", role: "launcher" },
      { label: "BOXA V3 Launcher", address: "0x56f810328a4e42e983f7f487f34776680d6cd7ab", role: "launcher" },
      { label: "BOXA Genesis Launcher", address: "0x8ca88b12bc89b58034c583f1a5df02f7e67d62e1", role: "launcher" },
      { label: "BOXA V3 Factory", address: "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883", role: "v3-factory" },
      { label: "BOXA Genesis V3 Factory", address: "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3", role: "v3-factory" },
      { label: "BOXA V4 PoolManager", address: POOL_MANAGERS.boxa, role: "v4-pool-manager" },
      { label: "BOXA V4 Hook", address: "0xb3e25cdf4a2f42e7f37ab3ae43bfb90ee8052acc", role: "v4-hook" },
      { label: "BOXA V4 Launcher Hook", address: "0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc", role: "v4-hook" },
      { label: "BOXA V4 Pair Hook", address: "0xd2f8e16ba85e9d160724e893b3ebce53d00e6acc", role: "v4-hook" },
      { label: "BOXA V4 Hook (shared PM)", address: "0x00c002cdae688f39a90cf2ad74c59421c9502acc", role: "v4-hook" },
    ],
    launchSources: [
      v3("BOXA V3 pools", "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883", 0),
      v3("BOXA Genesis V3 pools", "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3", 6_000),
      v4("BOXA V4 launcher hook pools", POOL_MANAGERS.boxa, "0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc", 8_000),
      v4("BOXA V4 hook pools", POOL_MANAGERS.boxa, "0xb3e25cdf4a2f42e7f37ab3ae43bfb90ee8052acc", 195_000),
      v4("BOXA V4 pair hook pools", POOL_MANAGERS.boxa, "0xd2f8e16ba85e9d160724e893b3ebce53d00e6acc", 270_000),
      v4("BOXA shared-PM hook pools", POOL_MANAGERS.shared, "0x00c002cdae688f39a90cf2ad74c59421c9502acc", 327_000),
    ],
    boxaIndexKey: "boxa",
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
      "Trading terminal and V4 launchpad with its own PoolManager and the Synapse hook.",
    groups: ["elyxa-v4"],
    contracts: [
      { label: "ELYXA Launcher", address: "0x1cb9e9093c940d027c08c63bf7321e146ba0656c", role: "launcher" },
      { label: "ELYXA V4 PoolManager", address: POOL_MANAGERS.elyxa, role: "v4-pool-manager" },
      { label: "Synapse V4 Hook", address: "0xe20830b30f2c016194035128e3601d97d5b660cc", role: "v4-hook" },
    ],
    launchSources: [v4("Synapse hook pools", POOL_MANAGERS.elyxa, "0xe20830b30f2c016194035128e3601d97d5b660cc", 61_000)],
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
      { label: "ObolPad", address: "0xfee823be55ee12b8c3a76aff0bd69470afaf2348", role: "launcher" },
      { label: "Obol V4 Hook", address: "0xd096377596efd99e3a80431e31cea857c226eacc", role: "v4-hook" },
      { label: "Obol V4 Hook v2", address: "0x4de07902f28d00736e29aa5739dea2d4ce98aacc", role: "v4-hook" },
    ],
    launchSources: [
      v4("Obol hook pools", POOL_MANAGERS.shared, "0xd096377596efd99e3a80431e31cea857c226eacc", 349_000),
      v4("Obol v2 hook pools", POOL_MANAGERS.shared, "0x4de07902f28d00736e29aa5739dea2d4ce98aacc", 1_808_000),
    ],
    boxaIndexKey: "obol",
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
      { label: "Eleos Launcher", address: "0x9c73d179b2911e89a4edc47cfd78765990bc6761", role: "launcher" },
      { label: "Eleos V4 PoolManager", address: POOL_MANAGERS.eleos, role: "v4-pool-manager" },
      { label: "Eleos V4 Hook", address: "0x8680965555dcea2a4c0ed3a29e59a8aa424e6acc", role: "v4-hook" },
      { label: "Eleos Pair Hook", address: "0xb0dcb98508173c29ad57df444ee3e91fc681aacc", role: "v4-hook" },
    ],
    launchSources: [
      v4("Eleos hook pools", POOL_MANAGERS.eleos, "0x8680965555dcea2a4c0ed3a29e59a8aa424e6acc", 86_000),
      v4("Eleos pair hook pools", POOL_MANAGERS.eleos, "0xb0dcb98508173c29ad57df444ee3e91fc681aacc", 187_000),
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
      { label: "Volta V4 Hook (shared PM)", address: "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc", role: "v4-hook" },
    ],
    launchSources: [v4("Volta hook pools", POOL_MANAGERS.shared, "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc", 272_000)],
    boxaIndexKey: "volta",
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
      { label: "Ronspad V3 Factory", address: "0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f", role: "v3-factory" },
      { label: "Ronspad PadFactory", address: "0x371811b06bd66c93b46f2f1ffd45b65455a2d2a2", role: "launcher" },
    ],
    launchSources: [v3("Ronspad V3 pools", "0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f", 219_000)],
    boxaIndexKey: "ronspad",
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
      { label: "ElysPump Launcher Hook", address: "0xe11cafa5901b0aab51eb78251488400f9e4320cc", role: "v4-hook" },
      { label: "ElysPump V3 Factory", address: "0x367f85886af509e364c8190862bc714555fefc3e", role: "v3-factory" },
      { label: "ElysPump V4 PoolManager", address: POOL_MANAGERS.elyspump, role: "v4-pool-manager" },
    ],
    launchSources: [
      v3("ElysPump V3 pools", "0x367f85886af509e364c8190862bc714555fefc3e", 0),
      v4("ElysPump hook pools", POOL_MANAGERS.elyspump, "0xe11cafa5901b0aab51eb78251488400f9e4320cc", 6_000),
    ],
    boxaIndexKey: "elyspump",
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
      { label: "Chainzy V3 Factory", address: "0x4f6cf2793119141c886544a4bca617ec906635b1", role: "v3-factory" },
      { label: "Chainzy V3 v2 Factory", address: "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615", role: "v3-factory" },
    ],
    launchSources: [
      v3("Chainzy V3 pools", "0x4f6cf2793119141c886544a4bca617ec906635b1", 3_000),
      v3("Chainzy V3 v2 pools", "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615", 4_000),
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
    summary: "Memecoin launchpad deploying hooked V4 pools on the shared PoolManager.",
    groups: ["stockium"],
    contracts: [
      { label: "Stockium Launcher", address: "0x696223f1fbae1a731d7001998dcd5a9fe032a48f", role: "launcher" },
      { label: "Stockium V4 Hook (shared PM)", address: "0x91f514cb71ab337873b26f4d8add03841db22aec", role: "v4-hook" },
    ],
    launchSources: [v4("Stockium hook pools", POOL_MANAGERS.shared, "0x91f514cb71ab337873b26f4d8add03841db22aec", 2_821_000)],
    boxaIndexKey: "stockium",
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
      { label: "Olympad Launcher", address: "0x55c7fcc06339e2d2fc5b444f52c24085c1da2549", role: "launcher" },
      { label: "Olympad V3 Factory", address: "0x3f8dde9d2a179a8c1272033368e0f22d63e340ec", role: "v3-factory" },
    ],
    launchSources: [v3("Olympad V3 pools", "0x3f8dde9d2a179a8c1272033368e0f22d63e340ec", 7_000)],
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
    // hookium.fun ships local-devnet contract addresses; no Elysium launch contract could be verified yet.
    contracts: [],
    launchSources: [],
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
      { label: "PerpMe V4 Hook (shared PM)", address: "0xb67656ce894ac93c0164d8490ad23161a77ee000", role: "v4-hook" },
      { label: "PerpFactory v2", address: "0xe35b622b0d37d57bf3e4d6930a057e58e7ba30be", role: "launcher" },
      { label: "PerpFactory v1", address: "0xa338c80bbec54f3439f6af22d21723226abc48bd", role: "launcher" },
      { label: "PerpFactory v0", address: "0x682dc0458815d1f4927d366fa91e645c71024d7b", role: "launcher" },
    ],
    launchSources: [v4("PerpMe hook pools", POOL_MANAGERS.shared, "0xb67656ce894ac93c0164d8490ad23161a77ee000", 304_000)],
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
      { label: "Supercolony Launcher", address: "0x450fa91b21971c605abe31ee479d46cb1182dd7b", role: "launcher" },
      { label: "Supercolony V3 Factory", address: "0x9f9169a859a940882452449db0f041c426d907b6", role: "v3-factory" },
    ],
    launchSources: [v3("Supercolony V3 pools", "0x9f9169a859a940882452449db0f041c426d907b6", 3_000)],
    token: null,
  },
  {
    id: "mesa",
    name: "Mesa",
    shortName: "Mesa",
    site: "https://mesa.cx",
    status: "live",
    summary: "One-click V4 token launchpad whose launcher is also the pool hook on the shared PoolManager.",
    groups: ["mesa"],
    contracts: [
      { label: "Mesa Launcher Hook", address: "0xe928f2336051cbd5b9d4531c25eadd13f9a82aec", role: "v4-hook" },
    ],
    launchSources: [v4("Mesa hook pools", POOL_MANAGERS.shared, "0xe928f2336051cbd5b9d4531c25eadd13f9a82aec", 916_000)],
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
    // The site is paused and no Hesperia launcher was found on chain 99901.
    contracts: [],
    launchSources: [],
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
      { label: "Ascend LaunchpadFactory", address: "0x63f6a8a8d0257c0363251a50cde8a8b1046e4d19", role: "launcher" },
      { label: "Ascend V4 Hook (shared PM)", address: "0xe0def4221b9840a610d4e7d55812a79a6431a8ec", role: "v4-hook" },
    ],
    launchSources: [v4("Ascend hook pools", POOL_MANAGERS.shared, "0xe0def4221b9840a610d4e7d55812a79a6431a8ec", 432_000)],
    boxaIndexKey: "ascend",
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
    launchSources: [],
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
    launchSources: [],
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
    // The shared PoolManager hosts many launchpads, so it never identifies one on its own.
    if (addr === POOL_MANAGERS.shared) continue;
    if (c.role === "v3-factory" || c.role === "v4-pool-manager" || c.role === "launcher") {
      BY_FACTORY.set(addr, lp);
    }
  }
  for (const s of lp.launchSources) {
    if (s.event === "v4-initialize" && s.hook) BY_HOOK.set(s.hook.toLowerCase(), lp);
    if (s.event === "v3-pool-created") BY_FACTORY.set(s.emitter.toLowerCase(), lp);
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
