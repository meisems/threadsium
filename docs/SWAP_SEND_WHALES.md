# Swap, Send / tip, and Whale watch

Three wallet-facing features added on 11 November 2026. None of them holds keys: every transaction is built in the page
and signed in the visitor's own browser wallet (EIP-1193, `window.ethereum`). Swaps carry a 1% platform fee (below);
Send and Whale watch take none.

## 1. Swap (`/app/swap`, and a panel in every token room)

Code: `src/lib/swap.ts` (routing, quotes, calldata; pure, tested in `tests/swap-send-whales.test.ts`),
`src/lib/wallet.ts` (wallet, chain switch, receipts, balances), `src/components/SwapPanel.tsx` (UI).

For a token, `findVenues` collects every venue with a live HYPE pool, `quoteLeg` quotes them all and keeps the one that
pays the most. Price impact compares the quote with a quote for 0.5% of the size on the same pool. The slippage setting
(0.5 / 1 / 3 / 5% or custom, remembered per browser) sets the minimum output the router enforces.

| Venue | Contracts on 99901 | How it was checked |
|---|---|---|
| Shared V4 PoolManager (Montra and every other native-HYPE pool there) | PoolManager `0xe2e105d3…23f1`, Montra LaunchRouter `0xc6e9a8e1…a157` (`quoteExactIn`, `swapExactIn`) | Montra's `/api/config` names both; `router.poolManager()` returns the manager; quotes answered for KNTQ, BOXA, KLEOS, OBOL and Montra pools; buy and sell simulated OK with state overrides |
| Kleos V4 / V5 | routers `0xba0b2699…344c`, `0xb15d5a01…6fc3`; launchers `0x893217cb…03e4`, `0x2da68edf…9502` | bytecode present; route map from the owner's kinepip project |
| BOXA V4 | router `0x7d812380…9496`, quoter `0x1ad2186a…fea4`, StateView `0xbc3aeff4…dba8` | published in boxa.club `/api/config`; quotes answered for BOXA |
| ElysPump V4 (Universal Router + Permit2) | router `0x751cefb9…b430`, quoter `0x48617417…ca6b`, Permit2 `0x00000000…8ba3` | bytecode present; not exercised on chain (no tested token had this pool) |
| Uniswap-V3 forks (BOXA, BOXA Genesis, ElysPump V3, StockiumSwap, KleosSwap) | five SwapRouter + QuoterV2 pairs in `V3_FAMILIES` | each router's `factory()` and `WETH9()` match its factory and WHYPE; KleosSwap V3 buy simulated OK |

Pool keys on the shared manager come from its `Initialize` events (`eth_getLogs`, allowed by `/api/rpc` for V4
managers). HYPE→token and token→HYPE are one transaction; token→token goes through HYPE as two, and the second spends
only the first one's guaranteed minimum. Sells check the ERC-20 allowance first and add an exact-amount approval step
(plus the Permit2 approval for ElysPump). Every swap is simulated from the visitor's wallet (`eth_call`) right before
it is sent, so a revert shows its reason instead of costing gas. Tokens with no supported pool (for example ELYXA, whose
pool sits on ELYXA's own V4 manager with no public router) show the error with a link to the token room's launchpad links.

### Platform fee (12 November 2026)

1% of the HYPE side of every swap goes to `0x377A6C8312F1271e70f67F24E2E533FcFdb39810` (`PLATFORM_FEE_RECIPIENT` in
`src/lib/swap.ts`, same design as the owner's kinepip project):

- **Buy (HYPE → token):** 1% of the HYPE is the fee and 99% is swapped, in one transaction through Multicall3
  `aggregate3Value` (swap with recipient = the buyer, then the fee transfer; no call may fail, so both or neither).
  The simulation reads Multicall3's balance around the swap; a router that would leave HYPE behind there falls back to
  the swap and the fee as two transactions.
- **Sell (token → HYPE):** 1% of the quoted HYPE output. Uniswap-V3 routers pay it inside the swap
  (`unwrapWETH9WithFee`); other routers pay out to the seller and the fee follows as a second transaction.
- **Token → token:** the fee is taken once, from the HYPE the buy leg spends.

The panel shows the fee and the amounts after it before anything is signed.

### Where swap reads go

The visitor's wallet first (when it is on Elysium 99901), then `/api/rpc?for=swap`, where the Worker tries the keyed
Alchemy endpoint in the `ALCHEMY_RPC_URL` secret and then the launchpads' nodes, then the launchpads' nodes directly
(Volta and Montra allow browsers). Public community RPCs (Kinetiq, Elyscan, AgoraDex) are used only for Whale watch
scans (`RPC_PUBLIC`); every other server read uses the launchpad list (`RPC_FALLBACKS`, Volta first because it is the
only node that answers `eth_getLogs` over the whole chain from Cloudflare).

## 2. Send / tip

Code: `src/components/SendAction.tsx` (button), `src/components/SendSheet.tsx` (sheet, lazy-loaded),
`worker/transfers.ts` (receipt check), `handleMessageTransfer` in `worker/social.ts`, migration `0003_message_transfers.sql`.

A Send action sits on post cards, replies (`PostThread`) and in a conversation's composer (`Inbox`). It sends native
HYPE or any ERC-20 to the author's linked wallet. If the person has not linked a wallet the button stays visible but
disabled; pressing it says why. Unverified (pasted) addresses are flagged in the sheet.

After the transaction is mined, `POST /api/messages/:username/transfer { hash, token?, note? }` records it. The Worker
reads the transaction and receipt and only accepts a successful transfer to the recipient's linked wallet (native: `tx.to`
and `tx.value`; token: a `Transfer` log from the sender to that wallet); the amount, symbol and decimals stored are the
ones the chain shows. `tx_hash` is unique, so a transaction can be recorded once. The conversation shows it as a
transfer bubble with the amount and a link to the Elysium explorer (elysium.kinetiq.xyz).

## 3. Whale watch (`/app/whales`, and a strip in every token room)

Whale watch is Threadsium's own feature: who is buying which token, and how big. It raises three signals on demand
(whale buy of 50 HYPE or more, fresh-wallet buy, accumulation). Funded clusters need each wallet's funding history, so
they are listed as not shown yet.

Code: `worker/whales/`: `classify.ts` (a transaction's net flows into a trade), `detectors.ts` (the signal rules,
pure and driven by block time), `types.ts`, `labels.ts` (mainnet base assets, bridge precompiles, launchpad labels and
thresholds), and `feed.ts` (`GET /api/whales`). UI: `src/pages/Whales.tsx`, `src/components/WhaleSignals.tsx`.

There is no always-on indexer: a Durable Object polling every block would spend the free tier's writes and alarms.
Instead `GET /api/whales` runs the classifier and detectors on demand over a recent window. In a token room: that
token's Transfer events over about 45 minutes (newest 100 transactions). For the whole chain: Elysium makes about 1,000
V4 swaps a minute, so the scan reads V4 Swap events over the last few minutes (the window halves while a node refuses
the log count), keeps swaps where HYPE went into a native-HYPE pool (pool ids checked against their Initialize events
and cached), reads the 200 largest transactions, and classifies the ones that sent HYPE with the transaction. Buys paid
from a router contract's balance are not visible to the classifier, and on 11 November 2026 they were most of the
large native-pool swaps, so the global scan finds few signals. A scan stays under about 20 subrequests (Workers allow 50).

**Nodes.** Scans ask the public community nodes first (`RPC_PUBLIC`) and fall back to the launchpads' nodes
(`scanEnv` in `worker/rpc.ts`). From Cloudflare's edge on 12 November 2026, Kinetiq's node answered 429, AgoraDex's
refused `eth_getLogs` over more than 10,000 blocks, and only Volta's answered the whole-chain pool lookup, so scans on
the public nodes alone returned HTTP 429 in token rooms and nothing at all chain-wide. The keyed Alchemy endpoint is
kept for swaps and is not used for scans.

A scan normally takes 4-6 s. Each RPC call waits at most 8 s, and an upstream that times out or errors is asked last
for the next minute (on 11 November 2026 `rpc.elyscan.live` took 17-25 s for a `getLogs` the others answered in 1-2 s).
If a scan is still past 20 s when it reaches the freshness step, it skips the nonce reads and symbol lookups, returns
the whale buys it has, and says so in `sourceNote`.

Answers are cached 20 s at the edge (and in KV when bound).

## Local development note

`/api/rpc` used to answer 403 through the Vite proxy because the Origin (`localhost:5173`) and the Worker's host
(`127.0.0.1:8845`) are different loopback names. `originAllowed` in `worker/proxy.ts` now treats any loopback origin
as same-site when the Worker itself is on loopback; production behaviour is unchanged.
