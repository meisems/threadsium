# Market data and room integrations

## `GET /api/market/:address?res=1m|15m|1h`

Code: `worker/market.ts` (I/O), `worker/marketCore.ts` (pure maths, tested in `tests/market.test.ts`).

- **Pools.** `Initialize` events on every V4 PoolManager in `src/config/v4.ts` and `PoolCreated` events on every V3 factory
  in `src/config/venues.ts`, filtered by the token's topic, keeping pools whose other side is native HYPE or a WHYPE.
  This needs `fromBlock 0`, which only Kinetiq's node allows; the list is kept for 10 minutes.
- **Price and depth.** One multicall: V4 pool state through `extsload` on the manager (pools mapping at slot 6, slot0,
  liquidity three slots later), V3 `slot0()` and the pool's WHYPE balance. The price is the deepest pool's.
- **Supply and caps.** Market cap = price × (totalSupply − balances of `0x…dEaD` and `0x0`); FDV = price × totalSupply;
  USD from `/api/price` (Hyperliquid HYPE mid). For bridged tokens such as KNTQ, totalSupply is the supply on Elysium,
  not the token's global supply.
- **Candles.** Swap logs folded into 1-minute bars with each log's `blockTimestamp`. Swaps in pools holding under 10%
  of the deepest pool's HYPE add volume only, so thin pools do not draw false wicks. V3 amounts are the pool's, V4
  amounts the swapper's; both are turned into buy (HYPE into the pool) or sell.
- **History.** Public nodes cap `eth_getLogs` at 10,000 blocks (BOXA, Agoradex, elyscan) or 10,000 logs (Kinetiq), so
  the bars live in the edge cache per token (`/__market/v2/store/<token>`, one week of minutes) and grow each request:
  new blocks first, then older pages back to the pools' creation, within a 5-second budget. A store too far behind
  starts over from the head. On 11 November 2026: a quiet token reached full history in 3 requests of 1-2 s; KNTQ (43
  pools, tens of thousands of swaps a day) took 3.6-6.2 s per request and covered 24 hours by the third.
- Responses are cached 15 s; the chart refreshes every 20 s while visible, the embed every 30 s.

## Ways to put a room in another project

All of them show the same room (`0x…`, `99901-0x…` and `99901:0x…` are one room). Snippets use `https://threadsium.app`
(`src/config/site.ts`) unless the page showing them runs on a real deployment.

| Option | What it is |
|---|---|
| Script | `public/widget.js`: `<div data-threadsium-room="0x…">` + one script tag. `data-theme` (dark, light, auto), `data-height`, `data-compact`, `data-market="0"`, `data-platform`. Fires `threadsium:ready`, `threadsium:post`, `threadsium:vote` on the element; `Threadsium.mount()` / `scan()` for rooms added later. Served with `Cross-Origin-Resource-Policy: cross-origin` (`public/_headers`). |
| iframe | `/embed/room/0x…?theme=…&compact=1&market=0&platform=…`. Theme can be switched with `postMessage({ type: "threadsium:theme", theme })`. |
| React | A small component around the iframe (copied from the room's Sync / Embed dialog). |
| API | `GET /api/rooms/0x…/sync`, `wss://…/api/rooms/0x…/ws`, `GET /api/market/0x…`: CORS-enabled reads, no key. Posting needs a Threadsium account, so writing goes through the widget. |
| Link | `https://threadsium.app/app/token/0x…`. |

The embed shows the token's price and market cap (HYPE and USD) from `/api/market` unless `market=0`.
