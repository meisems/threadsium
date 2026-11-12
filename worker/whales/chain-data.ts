// Elysium chain and launchpad facts for Whale watch (base assets, bridge contracts, RPC endpoints, launchpad
// venues, pool managers, hooks and routers), as checked on 9 November 2026. Kept as TypeScript, not JSON, so Node can
// import it in tests without import attributes.
export const CHAINS = {
  "_about": "Chain profiles. CHAIN=testnet|mainnet picks one. Every address carries its source. Entries with a `todo` field are NOT from the build prompt or Kinetiq's docs: verify them on an explorer before relying on them. Checked 9 November 2026.",
  "testnet": {
    "chainId": 99801,
    "label": "Testnet",
    "isTestnet": true,
    "provisional": false,
    "nativeSymbol": "HYPE",
    "publicRpc": [
      "https://testnet-rpc.elysium.kinetiq.xyz"
    ],
    "publicRpcSource": "https://elysium.kinetiq.xyz/docs/connecting-to-elysium (Kinetiq docs; the docs say production traffic should use a provider endpoint)",
    "historyRpc": [],
    "alchemyHttp": "https://elysium-testnet.g.alchemy.com/v2/{API_KEY}",
    "explorerBase": "https://testnet.elysium.kinetiq.xyz",
    "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "baseAssets": [
      {
        "address": "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "build prompt; Kinetiq docs /docs/contract-addresses"
      },
      {
        "address": "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
        "symbol": "USDC",
        "kind": "usdc",
        "decimals": 6,
        "source": "build prompt; Kinetiq docs /docs/contract-addresses",
        "todo": "decimals (6) read on chain at startup; verify on explorer"
      }
    ],
    "bridgeContracts": [
      {
        "address": "0x30545d8b24185DdFe83E75aB6939f867b664e2E1",
        "label": "ERC-20 gateway",
        "source": "build prompt"
      },
      {
        "address": "0x000000000000000000000000000000000000006E",
        "label": "ArbRetryableTx",
        "source": "build prompt"
      },
      {
        "address": "0x89659883a9d980925733B0A698F117AAb65ac718",
        "label": "Gateway router",
        "source": "Kinetiq docs /docs/contract-addresses",
        "todo": "verify on explorer"
      },
      {
        "address": "0x7255150a0340852Fe4B4B5657C5AcE6c09a4F959",
        "label": "Bridge wallet gateway",
        "source": "Kinetiq docs /docs/contract-addresses",
        "todo": "verify on explorer"
      },
      {
        "address": "0xb94A38a4aC46970559E89E566f2486a3Fc56BE5a",
        "label": "Bridge factory",
        "source": "Kinetiq docs /docs/contract-addresses",
        "todo": "verify on explorer"
      },
      {
        "address": "0x0000000000000000000000000000000000000064",
        "label": "ArbSys",
        "source": "Kinetiq docs /docs/contract-addresses (ArbOS precompile)",
        "todo": "verify on explorer"
      }
    ],
    "browserRpc": null
  },
  "mainnet": {
    "chainId": 99901,
    "label": "Mainnet",
    "isTestnet": false,
    "provisional": true,
    "provisionalNote": "Elysium mainnet (chain 99901) opens to the public on 9 November 2026. Kinetiq's own RPC at rpc.elysium.kinetiq.xyz answers chain 99901 and is read first. Kinetiq's docs still list the mainnet public RPC, explorer and contract addresses as coming soon, so this profile stays provisional until they are published.",
    "nativeSymbol": "HYPE",
    "publicRpc": [
      "https://rpc.elysium.kinetiq.xyz",
      "https://rpc-live.boxa.club",
      "https://boxa.club/api/rpc",
      "https://rpc.elyscan.live"
    ],
    "publicRpcSource": "Kinetiq's RPC first (rpc.elysium.kinetiq.xyz, on Kinetiq's own domain). On 9 November 2026 it returned chain ID 99901, the same block hash as Boxa at block 3,000,000, answered 100-item batches, archive state 500,000 blocks back, and full-history eth_getLogs (capped at 10,000 logs per answer). Kinetiq's docs page did not list it yet. Community RPCs (Boxa, Elyscan) follow as failover; Boxa refuses batches over 20 items, hence RPC_BATCH_MAX=20.",
    "publicRpcTodo": "When Kinetiq's docs list the mainnet public RPC, confirm it matches rpc.elysium.kinetiq.xyz. For production traffic Kinetiq recommends a provider endpoint (RPC_HTTP, e.g. Alchemy).",
    "historyRpc": [
      "https://rpc.elysium.kinetiq.xyz",
      "https://rpc.volta.family",
      "https://rpc.elyscan.live"
    ],
    "historyRpcSource": "Endpoints that answered address-filtered eth_getLogs from block 0: Kinetiq's (9 November 2026, 10,000-log cap per answer), Volta's (9 November 2026), Elyscan's (per Larpsium's notes). Used only to find a Uniswap V4 pool's hook from its Initialize event. Override with HISTORY_RPC.",
    "browserRpc": "https://rpc.elysium.kinetiq.xyz",
    "browserRpcSource": "Read from visitors' browsers for tracked-wallet balances (eth_getBalance, eth_getTransactionCount). Sends access-control-allow-origin: * (checked 9 November 2026). Must also be listed in connect-src in apps/web/public/_headers.",
    "alchemyHttp": "https://elysium-mainnet.g.alchemy.com/v2/{API_KEY}",
    "explorerBase": "https://elyscan.live",
    "explorerTodo": "elyscan.live is a community explorer. Kinetiq has not published a mainnet explorer. Replace EXPLORER_BASE when it does.",
    "multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
    "multicall3Source": "Canonical Multicall3 address; eth_getCode returned the Multicall3 runtime on 99901 (9 November 2026)",
    "baseAssets": [
      {
        "address": "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "elyxa.trade/api/config `whypes` (labelled WHYPE (ElysPump))",
        "todo": "verify on explorer"
      },
      {
        "address": "0xa27c79491bac6e20e2b18c0b21feb8dedd8caa41",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "elyxa.trade/api/config `whypes` (labelled WHYPE (BOXA))",
        "todo": "verify on explorer"
      },
      {
        "address": "0xaeb7ede82165bb12ea5c0c80ce8c0a0d05bce6af",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "elyxa.trade/api/config `whypes` (labelled WHYPE (Supercolony))",
        "todo": "verify on explorer"
      },
      {
        "address": "0x0269031ace34a7821e9d9980d087c35ce7c19eef",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "elyxa.trade/api/config `whypes` (labelled WHYPE (Kleos))",
        "todo": "verify on explorer"
      },
      {
        "address": "0x9f041fad8323d7c5bf8f928aade05b610df34b64",
        "symbol": "WHYPE",
        "kind": "whype",
        "decimals": 18,
        "source": "elyxa.trade/api/config `whypes` (labelled WHYPE (Obol))",
        "todo": "verify on explorer"
      }
    ],
    "baseAssetsTodo": "No canonical USDC address is published for 99901. Add it here with kind \"usdc\" once Kinetiq publishes mainnet addresses.",
    "bridgeContracts": [
      {
        "address": "0x000000000000000000000000000000000000006E",
        "label": "ArbRetryableTx",
        "source": "ArbOS precompile (same address on every Orbit chain)"
      },
      {
        "address": "0x0000000000000000000000000000000000000064",
        "label": "ArbSys",
        "source": "ArbOS precompile (same address on every Orbit chain)"
      }
    ],
    "bridgeContractsTodo": "Mainnet gateway addresses are published at launch. Add them here."
  }
} as const;

export const LAUNCHPADS = {
  "_about": [
    "Launchpad labels, per chain. Checked 9 November 2026 against the sources named on each entry.",
    "A trade's launchpad is the launchpad of the token's pool, found in this order: (1) `venues`: the contract that sent the token to the buyer is a launchpad's own pool manager, pad or hook; (2) `sharedPoolManagers`: the token sits in a shared Uniswap V4 PoolManager, so the pool's hook (from its Initialize event) is looked up in `hooks`; no hook = the manager's own name; (3) the sending pool's factory() is in `venues`; (4) `routers`: the address the buyer's transaction was sent to. Otherwise `unknown`.",
    "basis: first-party = the launchpad's own site, app bundle or API names the address; aggregator = another platform's published config (elyxa.trade/api/config, boxa.club/api/config) names it; third-party = only another project's code names it, plus the on-chain check given. Entries with `todo` should be confirmed on an explorer or with the launchpad.",
    "To find what is still unlabelled, run `npm run top-targets -- --chain mainnet`."
  ],
  "testnet": {
    "_todo": "TODO: testnet launchpads (Signal, Kiln, BunnyPad, CorePad, Oxley, Neuriio and others) are not labelled. Kinetiq's ecosystem page is behind a partner code and this deployment follows 99901.",
    "venues": [],
    "sharedPoolManagers": [],
    "hooks": [],
    "routers": []
  },
  "mainnet": {
    "venues": [
      {
        "address": "0x06c63714fbf1f5753017123e2fcfdede4540b2c4",
        "name": "BOXA",
        "kind": "v4-pool-manager",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4.poolManager); elyxa.trade/api/config"
      },
      {
        "address": "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883",
        "name": "BOXA",
        "kind": "v3-factory",
        "basis": "first-party",
        "source": "boxa.club/api/config (deployments.1.factory)"
      },
      {
        "address": "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3",
        "name": "BOXA",
        "kind": "v3-factory",
        "basis": "first-party",
        "source": "boxa.club/api/config (deployments.0.factory)"
      },
      {
        "address": "0xa9f082af704a8b2e0087cca2edb41e3ebf665e42",
        "name": "BOXA",
        "kind": "launcher",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4Pairs.launcher)"
      },
      {
        "address": "0xb308b5df891c300a5f5a5b8fdbc30108ba842490",
        "name": "Kleos",
        "kind": "v4-pool-manager",
        "basis": "first-party",
        "source": "thekleos.pro app bundle; elyxa.trade/api/config"
      },
      {
        "address": "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1",
        "name": "Kleos",
        "kind": "v3-factory",
        "basis": "first-party",
        "source": "thekleos.pro app bundle (KleosSwap V3 factory)"
      },
      {
        "address": "0x6e3afddc49f5d43858a1fdd48184426ded11029b",
        "name": "Kleos",
        "kind": "launcher",
        "basis": "first-party",
        "source": "thekleos.pro app bundle"
      },
      {
        "address": "0x5fb015a49f5b35073f9ce01c2adb287a75f89600",
        "name": "ElysPump",
        "kind": "v4-pool-manager",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (ElysPump v2 PoolManager)",
        "todo": "elyspump.fun needs a sign-in, so not confirmed from ElysPump itself"
      },
      {
        "address": "0x367f85886af509e364c8190862bc714555fefc3e",
        "name": "ElysPump",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (ElysPump V3 factory)",
        "todo": "Elysight's notes call this factory plain Uniswap V3; confirm with ElysPump"
      },
      {
        "address": "0x3564d7defdb26abe3f0953ee57d93953ec94fa25",
        "name": "ELYXA",
        "kind": "v4-pool-manager",
        "basis": "first-party",
        "source": "elyxa.trade/api/config (contracts.poolManager)"
      },
      {
        "address": "0x1cb9e9093c940d027c08c63bf7321e146ba0656c",
        "name": "ELYXA",
        "kind": "launcher",
        "basis": "first-party",
        "source": "elyxa.trade/api/config (contracts.launchpad)"
      },
      {
        "address": "0x5c54a7293d96b11a29a0256ee8dfdbc3059637da",
        "name": "Eleos",
        "kind": "v4-pool-manager",
        "basis": "first-party",
        "source": "eleos.fun page config (poolManager)"
      },
      {
        "address": "0x9c73d179b2911e89a4edc47cfd78765990bc6761",
        "name": "Eleos",
        "kind": "launcher",
        "basis": "first-party",
        "source": "eleos.fun page config (launcher)"
      },
      {
        "address": "0x5f702244f102183313e1b035fa846632c8b7e49f",
        "name": "Eleos",
        "kind": "launcher",
        "basis": "first-party",
        "source": "eleos.fun page config (launcherHigh)"
      },
      {
        "address": "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc",
        "name": "Volta",
        "kind": "hook",
        "basis": "first-party",
        "source": "volta.family app bundle (hook); its pools pay out from the hook"
      },
      {
        "address": "0x51d9243d87ad13d7eca55ab57357b2b5fc8241f2",
        "name": "Obol",
        "kind": "pad",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0x84941cb4495ff9c79af81ebcd46124809e65f7ec",
        "name": "Obol",
        "kind": "pad",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0x7d1904bfb2472a0ef97d886139a4236060e064ab",
        "name": "Obol",
        "kind": "pad",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0xfee823be55ee12b8c3a76aff0bd69470afaf2348",
        "name": "Obol",
        "kind": "pad",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0x4f66184a9ffabb7f7071d590c2c48dedf41676f4",
        "name": "Stockium",
        "kind": "v3-factory",
        "basis": "first-party",
        "source": "stockium.fun app bundle (swapFactory)"
      },
      {
        "address": "0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f",
        "name": "Ronspad",
        "kind": "v3-factory",
        "basis": "first-party",
        "source": "ronspad.fun/developers"
      },
      {
        "address": "0x371811b06bd66c93b46f2f1ffd45b65455a2d2a2",
        "name": "Ronspad",
        "kind": "launcher",
        "basis": "first-party",
        "source": "ronspad.fun/developers (PadFactory)"
      },
      {
        "address": "0x4f6cf2793119141c886544a4bca617ec906635b1",
        "name": "Chainzy",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (Chainzy V3 v1 factory)",
        "todo": "not found in chainzy.io's bundle"
      },
      {
        "address": "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615",
        "name": "Chainzy",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (Chainzy V3 v2 factory)",
        "todo": "not found in chainzy.io's bundle"
      },
      {
        "address": "0x9f9169a859a940882452449db0f041c426d907b6",
        "name": "Supercolony",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (Supercolony V3 factory)"
      },
      {
        "address": "0x3f8dde9d2a179a8c1272033368e0f22d63e340ec",
        "name": "Olympad",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (Olympad V3 factory)"
      },
      {
        "address": "0x55c7fcc06339e2d2fc5b444f52c24085c1da2549",
        "name": "Olympad",
        "kind": "launcher",
        "basis": "first-party",
        "source": "olympad.fun app bundle (VITE_LAUNCHPAD)"
      },
      {
        "address": "0xe35b622b0d37d57bf3e4d6930a057e58e7ba30be",
        "name": "PerpMe",
        "kind": "factory",
        "basis": "first-party",
        "source": "perpme.fun/elysium"
      },
      {
        "address": "0xa338c80bbec54f3439f6af22d21723226abc48bd",
        "name": "PerpMe",
        "kind": "factory",
        "basis": "first-party",
        "source": "perpme.fun/elysium"
      },
      {
        "address": "0x682dc0458815d1f4927d366fa91e645c71024d7b",
        "name": "PerpMe",
        "kind": "factory",
        "basis": "first-party",
        "source": "perpme.fun/elysium"
      },
      {
        "address": "0x1707327f626496a7b5b3872e7e4d2879df7d7a9f",
        "name": "Uniswap V3",
        "kind": "v3-factory",
        "basis": "third-party",
        "source": "perpme.fun/elysium: \"Uniswap Labs' own deployment on Elysium\", V3 factory; ronspad.fun bundle"
      },
      {
        "address": "0xf460854da9a40ad833c27996c749c1b8baaf3b86",
        "name": "Uniswap V3",
        "kind": "v3-factory",
        "basis": "aggregator",
        "source": "elyxa.trade/api/config (Uniswap V3 factory)"
      }
    ],
    "sharedPoolManagers": [
      {
        "address": "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1",
        "name": "Uniswap V4",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaUni.poolManager); ronspad.fun bundle names it Uniswap v4"
      }
    ],
    "hooks": [
      {
        "address": "0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec",
        "name": "Montra",
        "basis": "third-party",
        "source": "ronspad.fun bundle (MONTRA_HOOK); on chain every sampled pool with this hook was created by 0x38d3ef3a06d18fa3286fb5deafe611be725fcd15",
        "todo": "no Montra site found to confirm"
      },
      {
        "address": "0xe0def4221b9840a610d4e7d55812a79a6431a8ec",
        "name": "Ascend",
        "basis": "third-party",
        "source": "ronspad.fun bundle (ASCEND.hook on the Uniswap V4 manager)",
        "todo": "ascendlaunch.xyz is gated; confirm with Ascend"
      },
      {
        "address": "0xb67656ce894ac93c0164d8490ad23161a77ee000",
        "name": "PerpMe",
        "basis": "first-party",
        "source": "perpme.fun/elysium (Uniswap V4 hook)"
      },
      {
        "address": "0x3ab88ddc3cf2a012af88b60828edb4553697e5dc",
        "name": "Volta",
        "basis": "first-party",
        "source": "volta.family app bundle"
      },
      {
        "address": "0x00c002cdae688f39a90cf2ad74c59421c9502acc",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaUni.hook)"
      },
      {
        "address": "0x10f11002b148be522005f9b5d666bef339392aec",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaUniV2.hook)"
      },
      {
        "address": "0x4de07902f28d00736e29aa5739dea2d4ce98aacc",
        "name": "Obol",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0xd096377596efd99e3a80431e31cea857c226eacc",
        "name": "Obol",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      },
      {
        "address": "0x76d615181875cb7df2248197b9e573078df52acc",
        "name": "Obol",
        "basis": "first-party",
        "source": "tradeobol.world/api/config"
      }
    ],
    "routers": [
      {
        "address": "0x1b341fdd55d56f8e08409a2c25ddfad93eb03c1a",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaUni.router)"
      },
      {
        "address": "0x7d812380c241b331d753e8eef1cefdea4e539496",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4.router)"
      },
      {
        "address": "0x1a3e2535e6fe26c82dfd3600745349326b2355de",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4Pairs.router)"
      },
      {
        "address": "0x1932d3dd41c47f9d563e1fad78917a70d2c67504",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4MemePairs.router)"
      },
      {
        "address": "0x03c820b17f17ea86449f6cf700788c97511566c4",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (addresses.router)"
      },
      {
        "address": "0x3398765165b9aebf317036bf922f95f9bc6613c0",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (deployments.1.router)"
      },
      {
        "address": "0x00d4c904f74f74c6920c95e3ee807ab3c52dd205",
        "name": "BOXA",
        "basis": "first-party",
        "source": "boxa.club/api/config (boxaV4.launcher)"
      },
      {
        "address": "0x03c291d55cc178b8fc3e20607125b8f6e9d12687",
        "name": "Kleos",
        "basis": "first-party",
        "source": "thekleos.pro app bundle (router)"
      },
      {
        "address": "0x751cefb96ac88db5327d39e0fbdd5d882d80b430",
        "name": "ElysPump",
        "basis": "third-party",
        "source": "Elysight trade-venues (ElysPump V4 router, decoded from real trades 2 Nov 2026)",
        "todo": "confirm with ElysPump"
      },
      {
        "address": "0xf7d8d5f9b9125b3d29c5778df5e54c1bbe77f224",
        "name": "Stockium",
        "basis": "first-party",
        "source": "stockium.fun app bundle (swapRouter)"
      },
      {
        "address": "0xa13f7611115752deb2b13813bdde16a5073e4b45",
        "name": "Volta",
        "basis": "first-party",
        "source": "volta.family app bundle (universal router)"
      },
      {
        "address": "0x38d47e39beddde96e7db725569d9c5395bd279a0",
        "name": "Volta",
        "basis": "first-party",
        "source": "volta.family app bundle (HYPE launch router)"
      },
      {
        "address": "0x05b8da268ed4c3f26ab3eccc784885c4829d0ab1",
        "name": "ElysPad (UniPad)",
        "basis": "first-party",
        "source": "elysium.unipad.club app bundle (router)"
      },
      {
        "address": "0x38d3ef3a06d18fa3286fb5deafe611be725fcd15",
        "name": "Montra",
        "basis": "third-party",
        "source": "on chain: created the pools that use Montra's hook (see hooks)",
        "todo": "confirm with Montra"
      },
      {
        "address": "0x63f6a8a8d0257c0363251a50cde8a8b1046e4d19",
        "name": "Ascend",
        "basis": "third-party",
        "source": "on chain: created pools that use Ascend's hook (see hooks)",
        "todo": "confirm with Ascend"
      },
      {
        "address": "0x84f7ff8ffdd7f2331005375e5c7618f8611e872d",
        "name": "ELYXA",
        "basis": "first-party",
        "source": "elyxa.trade/api/config (contracts.terminal)"
      },
      {
        "address": "0x995a1cd63116a415221ea80116286a7aeb288f01",
        "name": "Eleos",
        "basis": "first-party",
        "source": "eleos.fun page config (bundler)"
      }
    ]
  }
} as const;
