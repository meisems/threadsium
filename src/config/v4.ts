// Verified Uniswap V4 PoolManagers on Elysium 99901.
// Most launchpad tokens (BOXA V4, Kleos V4/V5, ElysPump V4, ELYXA, Eleos, Shared) trade here against native HYPE (currency0 = 0x0).

export interface V4Manager {
  id: string;
  name: string;
  shortName: string;
  site: string | null;
  poolManager: string;
}

export const V4_INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
export const V4_SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

export const V4_MANAGERS: V4Manager[] = [
  {
    id: "shared-v4",
    name: "Elysium Shared V4",
    shortName: "Shared V4",
    site: null,
    poolManager: "0xe2e105d3f7209a9da11f83ccf3e7398a753823f1",
  },
  {
    id: "boxa-v4",
    name: "BOXA V4",
    shortName: "BOXA V4",
    site: "https://boxa.club",
    poolManager: "0x06c63714fbf1f5753017123e2fcfdede4540b2c4",
  },
  {
    id: "kleos-v4",
    name: "Kleos V4",
    shortName: "Kleos V4",
    site: "https://www.thekleos.pro",
    poolManager: "0xb308b5df891c300a5f5a5b8fdbc30108ba842490",
  },
  {
    id: "elyspump-v4",
    name: "ElysPump V4",
    shortName: "ElysPump V4",
    site: "https://elyspump.fun",
    poolManager: "0x5fb015a49f5b35073f9ce01c2adb287a75f89600",
  },
  {
    id: "elyxa-v4",
    name: "ELYXA V4",
    shortName: "ELYXA V4",
    site: "https://elyxa.trade",
    poolManager: "0x3564d7defdb26abe3f0953ee57d93953ec94fa25",
  },
  {
    id: "eleos-v4",
    name: "Eleos V4",
    shortName: "Eleos V4",
    site: "https://eleos.fun",
    poolManager: "0x5c54a7293d96b11a29a0256ee8dfdbc3059637da",
  },
];
