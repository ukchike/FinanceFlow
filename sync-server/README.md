# FinanceFlow sync relay

A tiny Cloudflare Worker + D1 database (free tier) that relays **end-to-end encrypted** shared
projects/budgets between FinanceFlow phones. The server only sees ciphertext and member roles.

## Deploy (once)
1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create financeflow-sync` → put the printed id in `wrangler.toml` (`database_id`)
4. `npx wrangler d1 migrations apply financeflow-sync --remote`
5. `npx wrangler deploy` → note the `https://financeflow-sync.<you>.workers.dev` URL; paste it in the app (Settings → Shared spaces).

## Test locally
```
npx wrangler d1 migrations apply financeflow-sync --local
npx wrangler dev --local --port 8787
node test/run.mjs
```
