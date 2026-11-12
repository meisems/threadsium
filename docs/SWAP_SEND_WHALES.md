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

Whale watch follows Elysium block by block and lists every buy of 5 HYPE or more (`STORE_MIN_HYPE`), newest first,
with fresh wallets marked. It raises four signals:

| Signal | Rule |
|---|---|
| Whale buy | one buy of at least 50 HYPE (`WHALE_MIN_HYPE`) |
| Fresh wallet | a buy of at least 5 HYPE from a wallet with 5 or fewer transactions, or first funded within 24 hours |
| Accumulation | the same wallet buying the same token 3+ times within 6 hours, at least 5 HYPE in all |
| Cluster | 3+ fresh wallets funded by the same address buying the same token within 10 minutes |

**The indexer.** `worker/whales/indexer.ts` is a SQLite Durable Object (`WHALES_DO`, class `WhaleIndexer`, migration
`v2`). Each alarm runs ticks for up to about 50 s or 40 subrequests (Workers Free allows 50), then sets the next
alarm. A tick reads the next block range's ERC-20 Transfer and WHYPE Withdrawal logs, the candidate transactions,
classifies trades (`classify.ts`), reads each buyer's nonce, and runs the detectors (`detectors.ts`). For new
wallets (nonce 5 or less) `wallets.ts` searches the last 24 hours of balance history for the block where the wallet
was first funded and names the funder; clusters come from those funders. Launchpads are attributed from venues,
pool managers, hooks and routers (`launchpads.ts`, `chain-data.ts`). Trades of 5 HYPE and up, wallets, tokens and
signals are stored; the cursor and per-token hourly counts let it resume after a restart. The cron (every 2 minutes)
and every `/api/whales` request restart the loop if it stopped.

**Nodes.** Every Elysium node the profile in `chain-data.ts` names: Kinetiq, BOXA (live and API), Elyscan, and Volta
(history). Each request fails over to the next node, and the watchdog (`rpcwatch.ts`) moves to the node that is
furthest ahead, or about twice as fast, when the chain head has not moved for 6 s. From Cloudflare's edge Kinetiq often
answers 429, so the indexer usually reads from BOXA, Elyscan or Volta. The keyed Alchemy endpoint is not used: polling
every few seconds would spend the swap key's allowance.

**API.** `GET /api/whales?token=&type=` answers from the indexer: `signals`, `buys` (stored buys of 5 HYPE and up),
`counts` (signals in the last 24 hours by type) and `indexer` (mode, lag, the node in use). While the indexer has
nothing stored yet it falls back to the on-demand scan in `feed.ts` (`source: "scan"`). `GET /api/whales/status`
returns the indexer's health (host names only, never a node URL). Answers are cached 10 s at the edge.

**Free-tier budget.** Rows written are counted per UTC day; past `WHALE_WRITE_BUDGET` (50,000) only signals and the
trades they cite are written, so Threadsium's own posts keep room in the account's 100,000 a day. The classifier,
detectors, wallet, launchpad, store and watchdog code and their tests (`tests/whales/`) come from the Elywake
indexer and behave the same.

## Local development note

`/api/rpc` used to answer 403 through the Vite proxy because the Origin (`localhost:5173`) and the Worker's host
(`127.0.0.1:8845`) are different loopback names. `originAllowed` in `worker/proxy.ts` now treats any loopback origin
as same-site when the Worker itself is on loopback; production behaviour is unchanged.
