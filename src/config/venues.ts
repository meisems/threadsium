// Verified Uniswap V3-style DEX and launchpad factories on Elysium 99901.
// Used for pool discovery, WHYPE depth ranking, and swap chart history.

export interface V3Venue {
  id: string;
  name: string;
  shortName: string;
  site: string | null;
  factory: string;
  whype: string;
}

export const CANONICAL_WHYPE = "0xba876237b0f021a6c6d852d6c26e107997cc5e81";
export const V3_POOL_CREATED_TOPIC =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
export const V3_SWAP_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export const V3_VENUES: V3Venue[] = [
  {
    id: "boxa",
    name: "BOXA V3",
    shortName: "BOXA V3",
    site: "https://boxa.club",
    factory: "0xe83aabbd2e326ceaae3bdcb605b3af94ac3cf883",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "boxa-genesis",
    name: "BOXA Genesis V3",
    shortName: "BOXA Gen V3",
    site: "https://boxa.club",
    factory: "0xd5a7c10820446c58868a204b8979b8cc9cb2a1a3",
    whype: "0xa27c79491bac6e20e2b18c0b21feb8dedd8caa41",
  },
  {
    id: "kleos",
    name: "KleosSwap V3",
    shortName: "Kleos V3",
    site: "https://www.thekleos.pro",
    factory: "0x809ff79945fffbf9b8df33bb3b62872ceb2efaf1",
    whype: "0x0269031ace34a7821e9d9980d087c35ce7c19eef",
  },
  {
    id: "elyspump-v3",
    name: "ElysPump V3",
    shortName: "ElysPump V3",
    site: "https://elyspump.fun",
    factory: "0x367f85886af509e364c8190862bc714555fefc3e",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "stockium",
    name: "StockiumSwap",
    shortName: "Stockium",
    site: "https://stockium.fun",
    factory: "0x9197bfaa11a76f628ba4c5efbe4e3f6e4ca48009",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "ronspad",
    name: "Ronspad V3",
    shortName: "Ronspad V3",
    site: "https://ronspad.fun",
    factory: "0x24e21e3f2b0bb0c166ec3eaff1e615ab14cdd85f",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "chainzy",
    name: "Chainzy V3",
    shortName: "Chainzy V3",
    site: "https://chainzy.io",
    factory: "0x4f6cf2793119141c886544a4bca617ec906635b1",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "chainzy-v2",
    name: "Chainzy V3 v2",
    shortName: "Chainzy v2",
    site: "https://chainzy.io",
    factory: "0xc098a2ee0cd4292751b4f7cfbb63e89207d45615",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "olympad",
    name: "Olympad V3",
    shortName: "Olympad V3",
    site: "https://olympad.fun",
    factory: "0x3f8dde9d2a179a8c1272033368e0f22d63e340ec",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "supercolony",
    name: "Supercolony V3",
    shortName: "Supercolony",
    site: null,
    factory: "0x9f9169a859a940882452449db0f041c426d907b6",
    whype: "0xaeb7ede82165bb12ea5c0c80ce8c0a0d05bce6af",
  },
  {
    id: "uni-1707",
    name: "Uniswap V3 (1707)",
    shortName: "Uni V3 1707",
    site: null,
    factory: "0x1707f8d38079ce3b4501779fbac42e69800bc112",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  {
    id: "uni-f460",
    name: "Uniswap V3",
    shortName: "Uni V3",
    site: null,
    factory: "0xf460854da9a40ad833c27996c749c1b8baaf3b86",
    whype: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
];

export const WHYPE_SET = new Set([
  ...V3_VENUES.map((v) => v.whype.toLowerCase()),
  "0xa27c7c2c12ed5c8e3bf24a3e4d034fe59a6fa580",
  "0x0269ef0fb05d8ab044bc19e2517bf32732820863",
  "0x9f041fad8323d7c5bf8f928aade05b610df34b64",
]);
