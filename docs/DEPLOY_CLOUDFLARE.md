# Deploying Threadsium on Cloudflare (Zero-Cost / Free Plan)

Threadsium is engineered for a **pure Cloudflare free-tier architecture** (`Cloudflare Workers Static Assets` + `SQLite Durable Object SocialStore` / optional `D1` + optional `R2` + optional `KV`). No external paid backend, third-party auth SaaS, or external database is required.

---

## 1. Connect Repository in Cloudflare Dashboard

1. Sign in to the [Cloudflare Dashboard](https://dash.cloudflare.com) and navigate to **Compute (Workers) → Workers & Pages → Create**.
2. Choose **Import a repository** and select your `threadsium` GitHub repository.
3. Configure the build settings:
   - **Project name:** `threadsium`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`

---

## 2. Bindings (`wrangler.jsonc` & Dashboard)

By default, `wrangler.jsonc` configures **`SOCIAL_DO`** (`SocialStore` SQLite-backed Durable Object) with automatic schema migration (`migrations/0001_threadsium.sql`) on first request. This works out-of-the-box on the Cloudflare Workers Free plan with zero manual database setup.

### Optional Dedicated D1, R2, and KV Bindings

If you also want to bind dedicated Cloudflare D1, R2, and KV resources in **Workers & Pages → threadsium → Settings → Bindings**:

| Binding Type | Variable Name | Resource Purpose | Free-Tier Quota |
| :--- | :--- | :--- | :--- |
| **Durable Object (SQLite)** | `SOCIAL_DO` | Default primary relational store (`SocialStore`) | 5 GB storage, 5M rows read/day, 100k writes/day |
| **D1 Database** *(optional)* | `DB` | Overrides `SOCIAL_DO` if bound (`npx wrangler d1 execute threadsium-db --file=./migrations/0001_threadsium.sql`) | 5 GB storage, 5M rows read/day, 100k writes/day |
| **R2 Bucket** *(optional)* | `MEDIA` | Stores uploaded post images, custom avatars, and banners (falls back to SQLite `media_objects` if unbound) | 10 GB storage/month, 1M Class A ops, 10M Class B ops |
| **KV Namespace** *(optional)* | `CACHE` | Edge cache for `/api/tokens`, `/api/price`, and `/api/logo/:addr` (falls back to Edge Cache API `caches.default` if unbound) | 1 GB storage, 100k reads/day, 1k writes/day |

---

## 3. Environment Variables & Secrets

In `wrangler.jsonc` (or **Settings → Variables and Secrets**):

| Variable | Value | Type |
| :--- | :--- | :--- |
| `CHAIN_ID` | `99901` | Plaintext var |
| `RPC_PRIMARY` | `https://rpc.elysium.kinetiq.xyz` | Plaintext var |
| `RPC_BACKUPS` | `https://rpc-live.boxa.club,https://rpc.elyscan.live,https://rpc.agoradex.app` | Plaintext var |
| `EXPLORER_URL` | `https://elysium.kinetiq.xyz` | Plaintext var |
| `HYPERLIQUID_INFO_URL` | `https://api.hyperliquid.xyz/info` | Plaintext var |
| `ALLOWED_ORIGINS` | *(optional comma-separated custom domains)* | Plaintext var |

*Note: Threadsium requires **zero private API keys** or operator secrets. Session cookies (`threadsium_sid`) and CSRF tokens are generated using the Web Crypto API (`crypto.getRandomValues` + `PBKDF2-SHA-256`) inside the Worker.*

---

## 4. Database Migrations

- **Automatic (`SOCIAL_DO`):** The `SocialStore` Durable Object automatically runs `migrations/0001_threadsium.sql` inside `blockConcurrencyWhile` on cold start and seeds the `@elysium_desk` welcome account.
- **Manual (`D1` override):** If you bind a separate D1 database as `DB`, run:
  ```bash
  npx wrangler d1 execute threadsium-db --remote --file=./migrations/0001_threadsium.sql
  ```

---

## 5. Preview Deployments & Custom Domains

- **Preview URLs:** Every pull request or non-production branch automatically deploys a preview Worker URL via Cloudflare Workers Builds.
- **Custom Domain:** In **Workers & Pages → threadsium → Settings → Domains & Routes → Add → Custom Domain**, enter your domain (e.g., `threadsium.xyz`). Cloudflare provisions the TLS certificate and edge routing automatically.

---

## 6. Monitoring Quotas & Hourly Cleanup Cron

- `wrangler.jsonc` registers an hourly cron trigger (`"23 * * * *"`) that prunes:
  - Expired user sessions
  - Notifications older than **12 hours**
  - Expired rate-limit counters
  - Excess media blobs if fallback SQLite storage exceeds 250 MB
- Check live storage usage anytime via `GET /api/status` or the **Settings** page inside the app.

---

## 7. Rollback Procedure

1. Open **Cloudflare Dashboard → Workers & Pages → threadsium → Deployments**.
2. Locate the previous healthy deployment version, click the **`⋯`** menu, and select **Rollback to this deployment**.
3. Or via CLI:
   ```bash
   npx wrangler rollback
   ```
