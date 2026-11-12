// Chain facts Whale watch needs: bases, routers, bridges, hooks and venues on Elysium mainnet (checked on 9 November
// 2026). Addresses are lower-case.
import type { Address } from "./types.ts";

/** WHYPE contracts (five deployments) count as the base asset, like native HYPE. No USDC is published on 99901. */
export const BASES = new Map<Address, { kind: "whype" | "usdc"; decimals: number }>(
  (
    [
      "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
      "0xa27c79491bac6e20e2b18c0b21feb8dedd8caa41",
      "0xaeb7ede82165bb12ea5c0c80ce8c0a0d05bce6af",
      "0x0269031ace34a7821e9d9980d087c35ce7c19eef",
      "0x9f041fad8323d7c5bf8f928aade05b610df34b64",
    ] as Address[]
  ).map((a) => [a, { kind: "whype" as const, decimals: 18 }]),
);

/** ArbOS precompiles: moves through them are bridge traffic, never trades. */
export const BRIDGES = new Set<Address>(["0x000000000000000000000000000000000000006e", "0x0000000000000000000000000000000000000064"]);

const pairs = (name: string, list: string[]) => list.map((a) => [a, name] as [Address, string]);

/** Contracts a token is bought from (pool managers, pads, factories' pools are not listed). */
export const VENUES = new Map<Address, string>([
  ...pairs("BOXA", ["0x06c63714fbf1f5753017123e2fcfdede4540b2c4", "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883", "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3", "0xa9f082af704a8b2e0087cca2edb41e3ebf665e42"]),
  ...pairs("Kleos", ["0xb308b5df891c300a5f5a5b8fdbc30108ba842490", "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1", "0x6e3afddc49f5d43858a1fdd48184426ded11029b"]),
  ...pairs("ElysPump", ["0x5fb015a49f5b35073f9ce01c2adb287a75f89600", "0x367f85886af509e364c8190862bc714555fefc3e"]),
  ...pairs("ELYXA", ["0x3564d7defdb26abe3f0953ee57d93953ec94fa25", "0x1cb9e9093c940d027c08c63bf7321e146ba0656c"]),
  ...pairs("Eleos", ["0x5c54a7293d96b11a29a0256ee8dfdbc3059637da", "0x9c73d179b2911e89a4edc47cfd78765990bc6761", "0x5f702244f102183313e1b035fa846632c8b7e49f"]),
  ...pairs("Volta", ["0x3ab88ddc3cf2a012af88b60828edb4553697e5dc"]),
  ...pairs("Obol", ["0x51d9243d87ad13d7eca55ab57357b2b5fc8241f2", "0x84941cb4495ff9c79af81ebcd46124809e65f7ec", "0x7d1904bfb2472a0ef97d886139a4236060e064ab", "0xfee823be55ee12b8c3a76aff0bd69470afaf2348"]),
  ...pairs("Stockium", ["0x4f66184a9ffabb7f7071d590c2c48dedf41676f4"]),
  ...pairs("Ronspad", ["0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f", "0x371811b06bd66c93b46f2f1ffd45b65455a2d2a2"]),
  ...pairs("Chainzy", ["0x4f6cf2793119141c886544a4bca617ec906635b1", "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615"]),
  ...pairs("Supercolony", ["0x9f9169a859a940882452449db0f041c426d907b6"]),
  ...pairs("Olympad", ["0x3f8dde9d2a179a8c1272033368e0f22d63e340ec", "0x55c7fcc06339e2d2fc5b444f52c24085c1da2549"]),
  ...pairs("PerpMe", ["0xe35b622b0d37d57bf3e4d6930a057e58e7ba30be", "0xa338c80bbec54f3439f6af22d21723226abc48bd", "0x682dc0458815d1f4927d366fa91e645c71024d7b"]),
  ...pairs("Uniswap V3", ["0x1707327f626496a7b5b3872e7e4d2879df7d7a9f", "0xf460854da9a40ad833c27996c749c1b8baaf3b86"]),
  ...pairs("Uniswap V4", ["0xe2e105d3f7209a9da11f83ccf3e7398a753823f1"]),
]);

/** V4 hooks on shared PoolManagers: a pool's hook names its launchpad. */
export const HOOKS = new Map<Address, string>([
  ...pairs("Montra", ["0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec"]),
  ...pairs("Ascend", ["0xe0def4221b9840a610d4e7d55812a79a6431a8ec"]),
  ...pairs("PerpMe", ["0xb67656ce894ac93c0164d8490ad23161a77ee000"]),
  ...pairs("Volta", ["0x3ab88ddc3cf2a012af88b60828edb4553697e5dc"]),
  ...pairs("BOXA", ["0x00c002cdae688f39a90cf2ad74c59421c9502acc", "0x10f11002b148be522005f9b5d666bef339392aec", "0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc"]),
  ...pairs("Obol", ["0x4de07902f28d00736e29aa5739dea2d4ce98aacc", "0xd096377596efd99e3a80431e31cea857c226eacc", "0x76d615181875cb7df2248197b9e573078df52acc"]),
  ...pairs("Uniswap V4", ["0x0000000000000000000000000000000000000000"]),
]);

/** The address a buyer's transaction was sent to (the fallback label). */
export const ROUTERS = new Map<Address, string>([
  ...pairs("BOXA", [
    "0x1b341fdd55d56f8e08409a2c25ddfad93eb03c1a",
    "0x7d812380c241b331d753e8eef1cefdea4e539496",
    "0x1a3e2535e6fe26c82dfd3600745349326b2355de",
    "0x1932d3dd41c47f9d563e1fad78917a70d2c67504",
    "0x03c820b17f17ea86449f6cf700788c97511566c4",
    "0x3398765165b9aebf317036bf922f95f9bc6613c0",
    "0x00d4c904f74f74c6920c95e3ee807ab3c52dd205",
  ]),
  ...pairs("Kleos", ["0x03c291d55cc178b8fc3e20607125b8f6e9d12687", "0xba0b2699a9d21a2a138c494db82dfd2ffce3344c", "0xb15d5a0159fc11bf1a1f9e383b0de76440ec6fc3"]),
  ...pairs("ElysPump", ["0x751cefb96ac88db5327d39e0fbdd5d882d80b430"]),
  ...pairs("Stockium", ["0xf7d8d5f9b9125b3d29c5778df5e54c1bbe77f224"]),
  ...pairs("Volta", ["0xa13f7611115752deb2b13813bdde16a5073e4b45", "0x38d47e39beddde96e7db725569d9c5395bd279a0"]),
  ...pairs("ElysPad (UniPad)", ["0x05b8da268ed4c3f26ab3eccc784885c4829d0ab1"]),
  ...pairs("Montra", ["0x38d3ef3a06d18fa3286fb5deafe611be725fcd15", "0xc6e9a8e1a99023b67067b8a3605403b8d7b3a157"]),
  ...pairs("Ascend", ["0x63f6a8a8d0257c0363251a50cde8a8b1046e4d19"]),
  ...pairs("ELYXA", ["0x84f7ff8ffdd7f2331005375e5c7618f8611e872d"]),
  ...pairs("Eleos", ["0x995a1cd63116a415221ea80116286a7aeb288f01"]),
]);

/** Whale watch thresholds. */
export const THRESHOLDS = {
  whaleMinHype: 50,
  freshMinHype: 5,
  freshMaxNonce: 5,
  freshMaxAgeHours: 24,
  accumMinBuys: 3,
  accumWindowMin: 360,
  accumMinTotalHype: 5,
  clusterMinWallets: 3,
  clusterWindowMin: 10,
  confirmations: 1,
  backfillBlocks: 20_000,
  storeMinHype: 5,
};
