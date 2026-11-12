// In-site swaps on Elysium 99901. Every route here was checked on chain (11 November 2026):
//   • Montra LaunchRouter 0xc6e9…a157 on the shared V4 PoolManager 0xe2e1…23f1 (Montra's /api/config names both;
//     router.poolManager() returns the manager). Quotes with quoteExactIn, which returns exactly what swapExactIn pays.
//   • Kleos V4 router 0xba0b…344c and V5 router 0xb15d…6fc3 (quoteBuy / quoteSell, buy / sell).
//   • BOXA V4 router 0x7d81…9496 with its V4 quoter 0x1ad2…fea4 (published in boxa.club/api/config).
//   • ElysPump V4 Universal Router 0x751c…b430 with its quoter 0x4861…a6b; sells go through Permit2.
//   • Five Uniswap-V3 SwapRouters with their QuoterV2s: each router's factory() and WETH9() match the factory and the
//     WHYPE its pools pair with (BOXA, BOXA Genesis, ElysPump/Uniswap V3, StockiumSwap, KleosSwap).
// The route map was recycled from the owner's kinepip project (src/lib/swap.ts), and so is its platform fee: 1% of the
// HYPE side of every swap goes to PLATFORM_FEE_RECIPIENT. Buys pay it inside the same transaction (through Multicall3,
// so it reverts with the swap); sells pay it from the HYPE they receive, inside the swap where the router can do that
// (Uniswap-V3 routers, unwrapWETH9WithFee) and otherwise as a separate transfer straight after.
// Nothing in this file signs; the visitor's wallet signs every step.
//
// Pure module: all chain reads go through the injected Reader, so it runs the same in the browser and in tests.
import { PLATFORM_FEE_RECIPIENT } from "../config/platform.ts";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, type Hex } from "viem";

export const NATIVE = "0x0000000000000000000000000000000000000000";
export type Side = "buy" | "sell";

/** One eth_call. Returns the raw result, or null when the call reverted or no node answered. */
export interface Reader {
  call(to: string, data: Hex, opts?: { from?: string; value?: bigint }): Promise<Hex | null>;
  /** eth_getLogs; null when no node answered. Used to find a token's pools on the shared V4 PoolManager. */
  logs?(filter: { address: string; topics: (Hex | null)[]; fromBlock: Hex; toBlock: "latest" }): Promise<{ data: Hex; topics: Hex[] }[] | null>;
}

export interface TxStep {
  to: string;
  data: Hex;
  value: bigint;
}

export interface Venue {
  id: string;
  name: string;
  /** The contract the swap transaction is sent to. */
  router: string;
  /** Who needs an ERC-20 allowance for a sell: the router, or Permit2 for Universal-Router venues. */
  spender: string;
  /** Set for Permit2 venues: after the ERC-20 approval, Permit2 itself must allow the router. */
  permit2?: string;
  quote(side: Side, amountIn: bigint): Promise<bigint | null>;
  tx(side: Side, amountIn: bigint, minOut: bigint, recipient: string, deadline: bigint): TxStep;
  /** A sell that pays the platform fee out of its own HYPE output, when the router can do that in the same call. */
  sellWithFee?(amountIn: bigint, minOut: bigint, recipient: string, deadline: bigint, feeRecipient: string, feeBps: number): TxStep;
}

/* ───────── platform fee ───────── */

// The platform fee wallet lives in src/config/platform.ts (shared with tips, sends, withdrawals and Premium payments).
export { PLATFORM_FEE_RECIPIENT };
export const PLATFORM_FEE_BPS = 100; // 1%
export const feeOf = (hypeWei: bigint): bigint => (hypeWei * BigInt(PLATFORM_FEE_BPS)) / 10_000n;

/**
 * Multicall3 (the canonical, ownerless deployment at the same address on nearly every EVM chain, also on Elysium
 * 99901). aggregate3Value forwards each call's value and reverts unless msg.value equals their sum; with
 * allowFailure = false on every call, a failed swap takes the fee transfer down with it. Only buys go through it: the
 * router sees Multicall3 as msg.sender, so it could never pull a seller's tokens (and approving Multicall3 would let
 * anyone spend that allowance). Multicall3 holds nothing between transactions.
 */
export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const MC3_VALUE_ABI = parseAbi([
  "struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3Value(Call3Value[] calls) payable returns (Result[] returnData)",
  "function getEthBalance(address addr) view returns (uint256)",
]);
const valueCall = (target: string, value: bigint, callData: Hex) => ({ target: target as Hex, allowFailure: false, value, callData });

/** A buy plus its fee as one transaction: [swap with the net HYPE, fee transfer], both or neither. */
export function buyWithFee(swap: TxStep, feeWei: bigint, feeRecipient: string = PLATFORM_FEE_RECIPIENT): TxStep {
  return {
    to: MULTICALL3,
    data: encodeFunctionData({
      abi: MC3_VALUE_ABI,
      functionName: "aggregate3Value",
      args: [[valueCall(swap.to, swap.value, swap.data), valueCall(feeRecipient, feeWei, "0x")]],
    }),
    value: swap.value + feeWei,
  };
}

/**
 * The same transaction for an eth_call, with Multicall3's own HYPE balance read before and after. A router that refunds
 * unspent HYPE to msg.sender would leave it in Multicall3; leftNothingBehind() catches that, and such a route falls back
 * to the swap and the fee as two transactions.
 */
export function buyWithFeeSimulation(swap: TxStep, feeWei: bigint, feeRecipient: string = PLATFORM_FEE_RECIPIENT): TxStep {
  const balance = valueCall(MULTICALL3, 0n, encodeFunctionData({ abi: MC3_VALUE_ABI, functionName: "getEthBalance", args: [MULTICALL3 as Hex] }));
  return {
    to: MULTICALL3,
    data: encodeFunctionData({
      abi: MC3_VALUE_ABI,
      functionName: "aggregate3Value",
      args: [[balance, valueCall(swap.to, swap.value, swap.data), valueCall(feeRecipient, feeWei, "0x"), balance]],
    }),
    value: swap.value + feeWei,
  };
}

/** True when a buyWithFeeSimulation answer shows Multicall3 ended the transaction holding what it held before it. */
export function leftNothingBehind(answer: Hex | null, sent: bigint): boolean {
  if (!answer) return false;
  try {
    const res = decodeFunctionResult({ abi: MC3_VALUE_ABI, functionName: "aggregate3Value", data: answer }) as readonly { success: boolean; returnData: Hex }[];
    if (res.length !== 4 || !res.every((x) => x.success)) return false;
    const before = BigInt(res[0].returnData);
    const after = BigInt(res[3].returnData);
    // The first read already includes the HYPE this transaction brought in.
    return after === before - sent;
  } catch {
    return false;
  }
}

/* ───────── shared encoding ───────── */

type PoolKey = { currency0: Hex; currency1: Hex; fee: number; tickSpacing: number; hooks: Hex };
const POOL_KEY = "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
const key = (token: string, fee: number, tickSpacing: number, hooks: string): PoolKey => ({
  currency0: NATIVE,
  currency1: token.toLowerCase() as Hex,
  fee,
  tickSpacing,
  hooks: hooks as Hex,
});
export const poolId = (k: PoolKey): Hex => keccak256(encodeAbiParameters(parseAbiParameters(POOL_KEY), [k]));

const word0 = (hex: Hex | null): bigint | null => (hex && /^0x[0-9a-fA-F]{64}/.test(hex) ? BigInt(hex.slice(0, 66)) : null);
const wordAt = (hex: Hex | null, i: number): bigint | null =>
  hex && hex.length >= 66 + i * 64 ? BigInt(`0x${hex.slice(2 + i * 64, 66 + i * 64)}`) : null;

/* ───────── Montra (shared V4 PoolManager) ───────── */

export const MONTRA = {
  router: "0xc6e9a8e1a99023b67067b8a3605403b8d7b3a157",
  poolManager: "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1",
  hooks: ["0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec"],
} as const;

const MONTRA_ABI = parseAbi([
  `struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }`,
  "struct SwapParams { PoolKey key; bool zeroForOne; uint128 amountIn; uint128 minOut; address recipient; uint256 deadline; }",
  "function quoteExactIn(PoolKey key, bool zeroForOne, uint128 amountIn) returns (uint256)",
  "function swapExactIn(SwapParams params) payable returns (uint256)",
]);

const feeLabel = (fee: number) => (fee & 0x800000 ? "dynamic fee" : `${+(fee / 10_000).toFixed(2)}%`);

/**
 * Any native-HYPE pool on the shared PoolManager. Montra's LaunchRouter takes any PoolKey on that manager, hooked or
 * not, and its quoteExactIn answers for all of them (checked on KNTQ, BOXA, KLEOS and OBOL pools).
 */
function sharedV4Venue(k: PoolKey, r: Reader): Venue {
  const montra = (MONTRA.hooks as readonly string[]).includes(k.hooks.toLowerCase());
  return {
    id: `shared-v4:${poolId(k)}`,
    name: montra ? "Montra" : `Elysium V4 ${feeLabel(k.fee)}`,
    router: MONTRA.router,
    spender: MONTRA.router,
    quote: async (side, amountIn) =>
      word0(await r.call(MONTRA.router, encodeFunctionData({ abi: MONTRA_ABI, functionName: "quoteExactIn", args: [k, side === "buy", amountIn] }))),
    tx: (side, amountIn, minOut, recipient, deadline) => ({
      to: MONTRA.router,
      data: encodeFunctionData({
        abi: MONTRA_ABI,
        functionName: "swapExactIn",
        args: [{ key: k, zeroForOne: side === "buy", amountIn, minOut, recipient: recipient as Hex, deadline }],
      }),
      value: side === "buy" ? amountIn : 0n,
    }),
  };
}

/* ───────── Kleos V4 / V5 ───────── */

export const KLEOS = {
  v4: { launcher: "0x893217cbf5c054fd6ee56893b313a4b98c4403e4", router: "0xba0b2699a9d21a2a138c494db82dfd2ffce3344c" },
  v5: { launcher: "0x2da68edff4588a77b55a829689c382f2acb39502", router: "0xb15d5a0159fc11bf1a1f9e383b0de76440ec6fc3" },
} as const;

const KLEOS_ABI = parseAbi([
  "function getLaunch(address token) view returns (uint256[])",
  "function launchConfigOf(address token) view returns (uint256)",
  "function quoteBuy(address token, uint256 hypeIn) view returns (uint256)",
  "function quoteSell(address token, uint256 tokenIn) view returns (uint256)",
  "function buy(address token, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)",
  "function sell(address token, uint256 amountIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)",
]);
const KLEOS5_ABI = parseAbi([
  "function quoteBuy(address token, uint256 hypeIn, uint24 tier) view returns (uint256)",
  "function quoteSell(address token, uint256 tokenIn, uint24 tier) view returns (uint256)",
  "function buy(address token, uint24 tier, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)",
  "function sell(address token, uint256 amountIn, uint24 tier, uint256 minOut, address recipient, uint256 deadline) returns (uint256)",
]);
const sel = (abi: typeof KLEOS_ABI, fn: "getLaunch" | "launchConfigOf", token: string) =>
  encodeFunctionData({ abi, functionName: fn, args: [token as Hex] } as never) as Hex;

function kleosV4(token: string, r: Reader): Venue {
  const t = token as Hex;
  const router = KLEOS.v4.router;
  return {
    id: "kleos-v4",
    name: "Kleos V4",
    router,
    spender: router,
    quote: async (side, amountIn) =>
      word0(
        await r.call(
          router,
          side === "buy"
            ? encodeFunctionData({ abi: KLEOS_ABI, functionName: "quoteBuy", args: [t, amountIn] })
            : encodeFunctionData({ abi: KLEOS_ABI, functionName: "quoteSell", args: [t, amountIn] }),
        ),
      ),
    tx: (side, amountIn, minOut, recipient, deadline) => ({
      to: router,
      data:
        side === "buy"
          ? encodeFunctionData({ abi: KLEOS_ABI, functionName: "buy", args: [t, minOut, recipient as Hex, deadline] })
          : encodeFunctionData({ abi: KLEOS_ABI, functionName: "sell", args: [t, amountIn, minOut, recipient as Hex, deadline] }),
      value: side === "buy" ? amountIn : 0n,
    }),
  };
}

function kleosV5(token: string, r: Reader): Venue {
  const t = token as Hex;
  const router = KLEOS.v5.router;
  return {
    id: "kleos-v5",
    name: "Kleos V5",
    router,
    spender: router,
    quote: async (side, amountIn) =>
      word0(
        await r.call(
          router,
          side === "buy"
            ? encodeFunctionData({ abi: KLEOS5_ABI, functionName: "quoteBuy", args: [t, amountIn, 0] })
            : encodeFunctionData({ abi: KLEOS5_ABI, functionName: "quoteSell", args: [t, amountIn, 0] }),
        ),
      ),
    tx: (side, amountIn, minOut, recipient, deadline) => ({
      to: router,
      data:
        side === "buy"
          ? encodeFunctionData({ abi: KLEOS5_ABI, functionName: "buy", args: [t, 0, minOut, recipient as Hex, deadline] })
          : encodeFunctionData({ abi: KLEOS5_ABI, functionName: "sell", args: [t, amountIn, 0, minOut, recipient as Hex, deadline] }),
      value: side === "buy" ? amountIn : 0n,
    }),
  };
}

/* ───────── BOXA V4 ───────── */

export const BOXA_V4 = {
  router: "0x7d812380c241b331d753e8eef1cefdea4e539496",
  quoter: "0x1ad2186a2734dc8715dea55967df823fd6e6fea4",
  stateView: "0xbc3aeff4c6c232d8b79cf9988cd522496e5edba8",
  hook: "0xbcc1f22d137c1d98dfa5548e4d4261d7aee06acc",
} as const;

const V4_QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const BOXA_ROUTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function buy(PoolKey key, uint256 minOut, address recipient, uint256 deadline) payable returns (uint256)",
  "function sell(PoolKey key, uint256 amountIn, uint256 minOut, address recipient, uint256 deadline) returns (uint256)",
]);
const STATE_VIEW_ABI = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160, int24, uint24, uint24)"]);

const v4Quote = (r: Reader, quoter: string, k: PoolKey) => async (side: Side, amountIn: bigint) =>
  word0(
    await r.call(
      quoter,
      encodeFunctionData({
        abi: V4_QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey: k, zeroForOne: side === "buy", exactAmount: amountIn, hookData: "0x" }],
      }),
    ),
  );

function boxaV4(token: string, r: Reader): Venue {
  const k = key(token, 0, 200, BOXA_V4.hook);
  return {
    id: "boxa-v4",
    name: "BOXA V4",
    router: BOXA_V4.router,
    spender: BOXA_V4.router,
    quote: v4Quote(r, BOXA_V4.quoter, k),
    tx: (side, amountIn, minOut, recipient, deadline) => ({
      to: BOXA_V4.router,
      data:
        side === "buy"
          ? encodeFunctionData({ abi: BOXA_ROUTER_ABI, functionName: "buy", args: [k, minOut, recipient as Hex, deadline] })
          : encodeFunctionData({ abi: BOXA_ROUTER_ABI, functionName: "sell", args: [k, amountIn, minOut, recipient as Hex, deadline] }),
      value: side === "buy" ? amountIn : 0n,
    }),
  };
}

/* ───────── ElysPump V4 (Universal Router + Permit2) ───────── */

export const ELYSPUMP = {
  router: "0x751cefb96ac88db5327d39e0fbdd5d882d80b430",
  quoter: "0x4861741785a8319a935741d0b570cafc33c4ca6b",
  stateView: "0xe83b98c30198319277c03d31f107277f40e96d70",
  hook: "0xe11cafa5901b0aab51eb78251488400f9e4320cc",
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
} as const;

const UR_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
// v4-periphery Actions: SWAP_EXACT_IN_SINGLE 0x06, SETTLE 0x0b, SETTLE_ALL 0x0c, TAKE 0x0e, TAKE_ALL 0x0f.
const V4_SWAP = "0x10";
const exactInSingle = (k: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint): Hex =>
  encodeAbiParameters(parseAbiParameters(`(${POOL_KEY} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint160 sqrtPriceLimitX96, bytes hookData)`), [
    { poolKey: k, zeroForOne, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n, hookData: "0x" },
  ]);
const abi = (types: string, values: readonly unknown[]): Hex => encodeAbiParameters(parseAbiParameters(types), values as never);

function urSwap(actions: Hex, params: Hex[], deadline: bigint, value: bigint): TxStep {
  const input = abi("bytes, bytes[]", [actions, params]);
  return { to: ELYSPUMP.router, data: encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: [V4_SWAP, [input], deadline] }), value };
}

function elysPumpV4(token: string, r: Reader): Venue {
  const k = key(token, 0, 200, ELYSPUMP.hook);
  const t = token as Hex;
  return {
    id: "elyspump-v4",
    name: "ElysPump V4",
    router: ELYSPUMP.router,
    spender: ELYSPUMP.permit2,
    permit2: ELYSPUMP.permit2,
    quote: v4Quote(r, ELYSPUMP.quoter, k),
    tx: (side, amountIn, minOut, recipient, deadline) =>
      side === "buy"
        ? // SETTLE the HYPE sent with the call (paid by the router), swap the open delta, TAKE the tokens to the buyer.
          urSwap(
            "0x0b060e",
            [abi("address, uint256, bool", [NATIVE, amountIn, false]), exactInSingle(k, true, 0n, minOut), abi("address, address, uint256", [t, recipient, 0n])],
            deadline,
            amountIn,
          )
        : // Swap, SETTLE_ALL the tokens from the seller through Permit2, TAKE_ALL the HYPE to the seller.
          urSwap(
            "0x060c0f",
            [exactInSingle(k, false, amountIn, minOut), abi("address, uint256", [t, amountIn]), abi("address, uint256", [NATIVE, minOut])],
            deadline,
            0n,
          ),
  };
}

const PERMIT2_ABI = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);

/** Whether Permit2 already lets `router` move `amount` of `token` for `owner` until at least `until`. */
export async function permit2Covers(r: Reader, owner: string, token: string, router: string, amount: bigint, until: bigint): Promise<boolean> {
  const res = await r.call(
    ELYSPUMP.permit2,
    encodeFunctionData({ abi: PERMIT2_ABI, functionName: "allowance", args: [owner as Hex, token as Hex, router as Hex] }),
  );
  return (wordAt(res, 0) ?? 0n) >= amount && (wordAt(res, 1) ?? 0n) >= until;
}

export function permit2Approve(token: string, router: string, amount: bigint, expiration: bigint): TxStep {
  return {
    to: ELYSPUMP.permit2,
    data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [token as Hex, router as Hex, amount, Number(expiration)] }),
    value: 0n,
  };
}

/* ───────── Uniswap-V3 forks ───────── */

export interface V3Family {
  name: string;
  factory: string;
  router: string;
  quoter: string;
  whype: string;
}

export const V3_FAMILIES: V3Family[] = [
  { name: "BOXA V3", factory: "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3", router: "0x03c820b17f17ea86449f6cf700788c97511566c4", quoter: "0x4f7dc08e8cc4579763bdec97dd9753086e4f1e3f", whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81" },
  { name: "BOXA Genesis V3", factory: "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883", router: "0x3398765165b9aebf317036bf922f95f9bc6613c0", quoter: "0x93900d707a3b283ccd2e998d233d2db6a326b73f", whype: "0xa27c79491bac6e20e2b18c0b21feb8dedd8caa41" },
  { name: "ElysPump V3", factory: "0x367f85886af509e364c8190862bc714555fefc3e", router: "0x10c2b8f290f90f373b9b86c14cdf532367d1a22e", quoter: "0x3e6158ef8ee2087b210a59939a1fff6d20c3dd7e", whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81" },
  { name: "StockiumSwap", factory: "0x4f66184a9ffabb7f7071d590c2c48dedf41676f4", router: "0xf7d8d5f9b9125b3d29c5778df5e54c1bbe77f224", quoter: "0x1947918b6bf36112f7ba8aa983e8d94ce574163a", whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81" },
  { name: "KleosSwap V3", factory: "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1", router: "0x03c291d55cc178b8fc3e20607125b8f6e9d12687", quoter: "0x18c139815b72f06a89e5e7f811427cd96b61caff", whype: "0x0269031ace34a7821e9d9980d087c35ce7c19eef" },
];
const V3_FEES = [10000, 3000, 500];

const V3_ABI = parseAbi([
  "function getPool(address a, address b, uint24 fee) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "struct QuoteSingle { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteSingle params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 ticksCrossed, uint256 gasEstimate)",
  "struct ExactInputSingle { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingle params) payable returns (uint256)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[])",
]);

function v3Venue(f: V3Family, fee: number, token: string, r: Reader): Venue {
  const t = token as Hex;
  const w = f.whype as Hex;
  const single = (tokenIn: Hex, tokenOut: Hex, recipient: string, deadline: bigint, amountIn: bigint, minOut: bigint) =>
    encodeFunctionData({
      abi: V3_ABI,
      functionName: "exactInputSingle",
      args: [{ tokenIn, tokenOut, fee, recipient: recipient as Hex, deadline, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    });
  return {
    id: `v3:${f.factory}:${fee}`,
    name: `${f.name} ${(fee / 10_000).toFixed(fee % 10_000 ? 2 : 0)}%`,
    router: f.router,
    spender: f.router,
    quote: async (side, amountIn) =>
      word0(
        await r.call(
          f.quoter,
          encodeFunctionData({
            abi: V3_ABI,
            functionName: "quoteExactInputSingle",
            args: [{ tokenIn: side === "buy" ? w : t, tokenOut: side === "buy" ? t : w, amountIn, fee, sqrtPriceLimitX96: 0n }],
          }),
        ),
      ),
    tx: (side, amountIn, minOut, recipient, deadline) =>
      side === "buy"
        ? // The router wraps the HYPE sent with the call into its WHYPE.
          { to: f.router, data: single(w, t, recipient, deadline, amountIn, minOut), value: amountIn }
        : // Swap into the router, then unwrap the WHYPE and pay native HYPE to the seller.
          {
            to: f.router,
            data: encodeFunctionData({
              abi: V3_ABI,
              functionName: "multicall",
              args: [[single(t, w, f.router, deadline, amountIn, minOut), encodeFunctionData({ abi: V3_ABI, functionName: "unwrapWETH9", args: [minOut, recipient as Hex] })]],
            }),
            value: 0n,
          },
    // Uniswap's PeripheryPaymentsWithFee: the unwrap pays feeBips of the HYPE to feeRecipient and the rest to the seller.
    sellWithFee: (amountIn, minOut, recipient, deadline, feeRecipient, feeBps) => ({
      to: f.router,
      data: encodeFunctionData({
        abi: V3_ABI,
        functionName: "multicall",
        args: [
          [
            single(t, w, f.router, deadline, amountIn, minOut),
            encodeFunctionData({ abi: V3_ABI, functionName: "unwrapWETH9WithFee", args: [minOut, recipient as Hex, BigInt(feeBps), feeRecipient as Hex] }),
          ],
        ],
      }),
      value: 0n,
    }),
  };
}

/* ───────── discovery ───────── */

/**
 * Every venue with a live HYPE pool for `token`. Montra comes first and alone when it launched the token (its pool is
 * where the token trades); otherwise Kleos V4/V5, BOXA V4, ElysPump V4 and the deepest V3 pool are all offered.
 */
export async function findVenues(token: string, r: Reader): Promise<Venue[]> {
  const t = token.toLowerCase();
  const kleosAbiCall = (launcher: string, fn: "getLaunch" | "launchConfigOf") => r.call(launcher, sel(KLEOS_ABI, fn, t));
  const slot0 = (stateView: string, k: PoolKey) => r.call(stateView, encodeFunctionData({ abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId(k)] }));

  const [shared, k4, k5, boxa, pump, v3] = await Promise.all([
    sharedV4Pools(t, r),
    kleosAbiCall(KLEOS.v4.launcher, "getLaunch"),
    kleosAbiCall(KLEOS.v5.launcher, "getLaunch"),
    slot0(BOXA_V4.stateView, key(t, 0, 200, BOXA_V4.hook)),
    slot0(ELYSPUMP.stateView, key(t, 0, 200, ELYSPUMP.hook)),
    deepestV3(t, r),
  ]);
  const venues: Venue[] = [...shared];
  if ((wordAt(k4, 7) ?? 0n) !== 0n) venues.push(kleosV4(t, r));
  if ((wordAt(k5, 7) ?? 0n) !== 0n) {
    const cfg = await kleosAbiCall(KLEOS.v5.launcher, "launchConfigOf");
    if (word0(cfg) === 0n) venues.push(kleosV5(t, r));
  }
  if ((word0(boxa) ?? 0n) !== 0n) venues.push(boxaV4(t, r));
  if ((word0(pump) ?? 0n) !== 0n) venues.push(elysPumpV4(t, r));
  if (v3) venues.push(v3);
  return venues;
}

const V4_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const topicOf = (addr: string): Hex => `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const int24 = (hexWord: string) => {
  const v = parseInt(hexWord.slice(-6), 16);
  return v >= 0x800000 ? v - 0x1000000 : v;
};

/**
 * The token's native-HYPE pools on the shared PoolManager (from its Initialize events), probed with a small buy and
 * cut to the three that pay the most. Without logs, Montra's own hook is probed directly.
 */
async function sharedV4Pools(token: string, r: Reader): Promise<Venue[]> {
  const keys: PoolKey[] = [];
  const logs = r.logs
    ? await r.logs({ address: MONTRA.poolManager, topics: [V4_INITIALIZE, null, topicOf(NATIVE), topicOf(token)], fromBlock: "0x0", toBlock: "latest" }).catch(() => null)
    : null;
  if (logs) {
    for (const l of logs) {
      const d = l.data.slice(2);
      if (d.length < 192) continue;
      keys.push(key(token, parseInt(d.slice(0, 64), 16), int24(d.slice(64, 128)), `0x${d.slice(152, 192)}`));
    }
  } else {
    for (const hook of MONTRA.hooks) keys.push(key(token, 0x800000, 200, hook));
  }
  const probe = 10n ** 15n;
  const probed = await Promise.all(
    keys.slice(0, 60).map(async (k) => {
      const v = sharedV4Venue(k, r);
      return { v, out: await v.quote("buy", probe).catch(() => null) };
    }),
  );
  return probed
    .filter((p): p is { v: Venue; out: bigint } => p.out !== null && p.out > 0n)
    .sort((a, b) => (b.out > a.out ? 1 : b.out < a.out ? -1 : 0))
    .slice(0, 3)
    .map((p) => p.v);
}

async function deepestV3(token: string, r: Reader): Promise<Venue | null> {
  const found = await Promise.all(
    V3_FAMILIES.flatMap((f) =>
      V3_FEES.map(async (fee) => {
        const res = await r.call(f.factory, encodeFunctionData({ abi: V3_ABI, functionName: "getPool", args: [token as Hex, f.whype as Hex, fee] }));
        const w = word0(res);
        if (!w) return null;
        const pool = `0x${w.toString(16).padStart(40, "0")}`;
        const depth = word0(await r.call(f.whype, encodeFunctionData({ abi: V3_ABI, functionName: "balanceOf", args: [pool as Hex] })));
        return depth && depth > 0n ? { f, fee, depth } : null;
      }),
    ),
  );
  const pools = found.filter((p): p is { f: V3Family; fee: number; depth: bigint } => p !== null);
  if (!pools.length) return null;
  const best = pools.reduce((a, b) => (b.depth > a.depth ? b : a));
  return v3Venue(best.f, best.fee, token, r);
}

/* ───────── quotes ───────── */

export interface LegQuote {
  side: Side;
  token: string;
  venue: Venue;
  amountIn: bigint;
  out: bigint;
  minOut: bigint;
  /** Price impact in basis points against a quote for 0.5% of the size, or null when it could not be measured. */
  impactBps: number | null;
}

/** Quotes every venue and keeps the one that pays the most; then measures price impact on that venue. */
export async function quoteLeg(token: string, side: Side, amountIn: bigint, slippageBps: number, venues: Venue[]): Promise<LegQuote | null> {
  if (!venues.length || amountIn <= 0n) return null;
  const outs = await Promise.all(venues.map(async (v) => ({ v, out: await v.quote(side, amountIn).catch(() => null) })));
  const priced = outs.filter((o): o is { v: Venue; out: bigint } => o.out !== null && o.out > 0n);
  if (!priced.length) return null;
  const best = priced.reduce((a, b) => (b.out > a.out ? b : a));

  let impactBps: number | null = null;
  const small = amountIn / 200n;
  if (small > 0n) {
    const smallOut = await best.v.quote(side, small).catch(() => null);
    if (smallOut && smallOut > 0n) {
      // (out / in) / (smallOut / small) = execution price over the near-spot price.
      const ratio = (best.out * small * 1_000_000n) / (amountIn * smallOut);
      impactBps = Math.max(0, Math.round((1_000_000 - Number(ratio)) / 100));
    }
  }
  return {
    side,
    token: token.toLowerCase(),
    venue: best.v,
    amountIn,
    out: best.out,
    minOut: (best.out * BigInt(10_000 - slippageBps)) / 10_000n,
    impactBps,
  };
}

export interface SwapQuote {
  legs: LegQuote[];
  amountIn: bigint;
  /** What the visitor is expected to receive, after the platform fee. */
  out: bigint;
  /** The least the visitor receives, after the platform fee, before the swap reverts. */
  minOut: bigint;
  /** The 1% platform fee in HYPE wei, and which leg pays it: a buy pays it from its HYPE input, a sell from its output. */
  fee: { wei: bigint; leg: number; side: Side };
  /** Combined impact of all legs. */
  impactBps: number | null;
}

/**
 * HYPE → token and token → HYPE are one swap. Token → token goes through HYPE as two swaps: the second spends only the
 * first one's guaranteed minimum, so it can never spend HYPE the first did not produce.
 */
export async function quoteSwap(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  slippageBps: number,
  venuesFor: (token: string) => Promise<Venue[]>,
): Promise<SwapQuote | { error: string }> {
  const a = tokenIn.toLowerCase();
  const b = tokenOut.toLowerCase();
  if (a === b) return { error: "Pick two different assets." };
  const legs: LegQuote[] = [];
  let fee: SwapQuote["fee"];
  let out: bigint;
  let minOut: bigint;
  if (a === NATIVE) {
    // Buy: 1% of the HYPE is the fee, the other 99% is swapped.
    const feeWei = feeOf(amountIn);
    const leg = await quoteLeg(b, "buy", amountIn - feeWei, slippageBps, await venuesFor(b));
    if (!leg) return { error: "No pool on Elysium quotes this buy. The token may have no HYPE liquidity yet." };
    legs.push(leg);
    fee = { wei: feeWei, leg: 0, side: "buy" };
    out = leg.out;
    minOut = leg.minOut;
  } else if (b === NATIVE) {
    // Sell: the fee is 1% of the HYPE the swap pays out.
    const leg = await quoteLeg(a, "sell", amountIn, slippageBps, await venuesFor(a));
    if (!leg) return { error: "No pool on Elysium quotes this sell. The token may have no HYPE liquidity yet." };
    legs.push(leg);
    const feeWei = feeOf(leg.out);
    fee = { wei: feeWei, leg: 0, side: "sell" };
    out = leg.out - feeWei;
    minOut = leg.minOut - feeWei;
  } else {
    // Token to token: sell for HYPE, then buy; the fee is taken once, from the HYPE the buy spends.
    const [va, vb] = await Promise.all([venuesFor(a), venuesFor(b)]);
    const sell = await quoteLeg(a, "sell", amountIn, slippageBps, va);
    if (!sell) return { error: "No pool on Elysium quotes selling the first token for HYPE." };
    const feeWei = feeOf(sell.minOut);
    const buy = await quoteLeg(b, "buy", sell.minOut - feeWei, slippageBps, vb);
    if (!buy) return { error: "No pool on Elysium quotes buying the second token with HYPE." };
    legs.push(sell, buy);
    fee = { wei: feeWei, leg: 1, side: "buy" };
    out = buy.out;
    minOut = buy.minOut;
  }
  // Impacts compound: keeping (1 - a) of the price on one leg and (1 - b) on the next keeps (1 - a)(1 - b).
  let kept: number | null = 10_000;
  for (const l of legs) kept = kept === null || l.impactBps === null ? null : (kept * (10_000 - l.impactBps)) / 10_000;
  const impactBps = kept === null ? null : Math.round(10_000 - kept);
  return { legs, amountIn, out, minOut, impactBps, fee };
}

/** Readable reason from a revert payload or message. */
export function revertReason(data: string | null | undefined, message?: string): string {
  const d = data ?? "";
  if (d.startsWith("0x08c379a0") && d.length >= 138) {
    const len = Number(BigInt(`0x${d.slice(74, 138)}`));
    const bytes = d.slice(138, 138 + len * 2).match(/../g) ?? [];
    const text = new TextDecoder().decode(Uint8Array.from(bytes, (x) => parseInt(x, 16))).replace(/[^\x20-\x7e]/g, "").slice(0, 160);
    if (text) return text;
  }
  const m = (message ?? "").replace(/0x[0-9a-f]{20,}/gi, "").trim();
  if (/transfer amount exceeds balance|exceeds balance/i.test(m)) return "Your wallet does not hold that many tokens.";
  if (/insufficient funds/i.test(m)) return "Your wallet does not hold enough HYPE for this amount plus gas.";
  return m.slice(0, 160) || "The swap would revert on chain.";
}
