# Threadsium — Elysium 99901 Web3 Social & Trench Terminal

**Threadsium** is a dedicated Web3 social network, token launchpad discussion room, and live on-chain swap chart terminal built for **Elysium** (`chainId: 99901` · `0x1863d`, provisional network profile, native currency `HYPE`).

Modeled on the social workflow of `ponsthreads` and tailored to the Elysium 99901 ecosystem (`elysight`, `larpsium`, `kinepip`, `poolsium`), Threadsium runs end-to-end on a zero-cost Cloudflare Workers + SQLite Durable Object (`SocialStore` / D1) + R2 + KV stack.

## Key Capabilities

- **Elysium 99901 Social Timeline:** Compose threads (up to 500 chars), attach images, like, rethread (pure repost), quote-repost, reply in nested trees, pin a flagship post to your profile, and share threads.
- **Auto-Linked `$TICKER`, `0x` Contracts & `#hashtags`:** Mentions of `$KNTQ`, `$BOXA`, `$KLEOS`, `$ELYXA`, `$OBOL`, `$EOS`, `$RONS`, or any 40-hex `0x` token address automatically link to dedicated token rooms.
- **Dedicated Token Rooms (`/app/token/:address`):**
  - Native on-chain Uniswap V3 & V4 `Swap` event candlestick charts (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) with `HYPE` / `USD` toggle and recent trades linked to `elyscan.live`.
  - Community 1–5 star ratings and Bullish / Bearish sentiment voting.
  - On-chain wallet holder badges (`🐋 Whale ≥ 1% supply`, `✓ Holder > 0`, `Spectator`).
  - Nested Token Timeline comments and Related Feed Posts.
- **Hall of Fame & Trench Search:** Live discovery across 7 Uniswap V3 factories and 6 Uniswap V4 PoolManagers on Elysium 99901 plus seeded launchpad tokens (`BOXA`, `Kleos`, `ELYXA`, `ElysPump`, `Ronspad`, `Kinetiq`).
- **1-to-1 Direct Messages & 12-Hour Notifications:** Real-time DMs between connected operators and a rolling 12-hour notification inbox with automatic cron pruning.
- **Server-Enforced Security & Cache Isolation:** PBKDF2-SHA-256 (100k iterations) password hashing, `HttpOnly; SameSite=Lax` session cookies, `X-CSRF-Token` + Origin verification, magic-byte media validation, and `Cache-Control: private, no-store` on all user-specific routes.

## Local Development

```bash
# Typecheck frontend + Worker
npm run typecheck

# Run unit tests
npm test

# Build production bundle
npm run build

# Run local Cloudflare Worker + SQLite Durable Object on http://127.0.0.1:8845
npm run cf:dev
```

See [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md) for Cloudflare dashboard deployment steps.
