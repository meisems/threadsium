// Threadsium's official token. This is the single place its contract address (CA) lives: the landing page, the
// right rail, the docs, the Premium page and the Worker's Premium checks all read it from here.
// Checked on chain 99901 (eth_getCode, name, symbol, decimals) on 2026-11-16.

export const OFFICIAL_TOKEN = {
  address: "0xa9341ac2d2aaafc65bc68277c1c2885287b84603",
  symbol: "THREADSIUM",
  name: "Threadsium",
  decimals: 18,
} as const;
