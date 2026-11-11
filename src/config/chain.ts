// Elysium network configuration (Chain 99901, native HYPE).
// Verified against Kinetiq's RPC, Boxa, Elyscan, and HyperEVM rollup records (November 2026).

export const CHAIN = {
  id: 99901,
  hexId: "0x1863d",
  name: "Elysium",
  shortLabel: "Elysium 99901 · provisional",
  standing:
    "Elysium mainnet candidate (chain 99901), an Arbitrum Orbit rollup settling to HyperEVM (chain 999). Kinetiq's public docs still mark mainnet details as coming soon, so Threadsium labels 99901 as provisional.",
  provisional: true,
  native: { symbol: "HYPE", name: "HYPE", decimals: 18 },
  rpcPrimary: "https://rpc.elysium.kinetiq.xyz",
  rpcBackups: [
    "https://rpc-live.boxa.club",
    "https://rpc.elyscan.live",
    "https://rpc.agoradex.app",
  ],
  /**
   * Launchpad nodes the browser may call directly when Threadsium's own /api/rpc does not answer (both send
   * Access-Control-Allow-Origin: *). BOXA's nodes refuse other sites' browsers, so they are reached through /api/rpc.
   */
  launchpadRpcs: ["https://rpc.volta.family", "https://rpc.montramarkets.xyz"],
  browserRpc: "https://rpc.elysium.kinetiq.xyz",
  walletRpc: "https://rpc.elysium.kinetiq.xyz",
  walletRpcBackups: [
    "https://rpc-live.boxa.club",
    "https://rpc.elyscan.live",
    "https://rpc.agoradex.app",
  ],
  explorer: "https://elyscan.live",
  explorerUrl: "https://elyscan.live",
  explorerNote:
    "elyscan.live is a community block explorer; Kinetiq has not published a first-party mainnet explorer yet.",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  poolsiumUrl: "https://poolsium.app",
  boxaUrl: "https://boxa.club",
  kleosUrl: "https://www.thekleos.pro",
  elyxaUrl: "https://elyxa.trade",
} as const;

export const ELYSIUM_CHAIN = CHAIN;
export const MULTICALL3_ADDRESS = CHAIN.multicall3;

export function explorerTx(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}
export function explorerAddress(addr: string): string {
  return `${CHAIN.explorer}/address/${addr}`;
}
export function explorerToken(addr: string): string {
  return `${CHAIN.explorer}/token/${addr}`;
}
export function explorerBlock(n: number): string {
  return `${CHAIN.explorer}/block/${n}`;
}

export const explorerTxUrl = explorerTx;
export const explorerAddressUrl = explorerAddress;
export const explorerTokenUrl = explorerToken;
export const explorerBlockUrl = explorerBlock;
