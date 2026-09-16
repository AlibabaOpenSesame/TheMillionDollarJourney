# Cloudflare production

- Primary domain: https://openinvestai.com
- English: https://openinvestai.com/en
- www redirects permanently to the primary domain, preserving path/query.
- Worker: `the-million-dollar-journey`.
- D1 database: `million-dollar-journey`, binding `DB`.
- Cron: `30 23 * * *` UTC, daily 07:30 Asia/Shanghai.

## Build and deploy

```sh
npm ci
npm run build:cloudflare
npm run test:unit
npx wrangler deploy
```

`build:cloudflare` selects `wrangler.jsonc`; the original `npm run build` retains Sites-compatible configuration. Wrangler uses the generated `dist/server/wrangler.json` after building. Do not deploy directly from a build made for the other target.

For Cloudflare Builds, select this GitHub repository and production branch `main`, build with `npm run build:cloudflare && npm run test:unit`, and deploy with `npx wrangler deploy`. Disable non-production branch deployments to avoid connecting unreviewed code to the production database. No API keys belong in build output or GitHub source.

## Database

The three Drizzle migrations have been applied and all 222 exported rows imported (195 snapshots, 16 positions, 1 FX rate, 10 sync runs). Latest stored portfolio date is 2026-09-14.

For an intentional restore only:

```sh
npm run db:migrate:cloudflare
node scripts/portfolio-export.mjs --sql --d1 --output portfolio-seed.sql
npx wrangler d1 execute million-dollar-journey --remote --config wrangler.jsonc --file portfolio-seed.sql --yes
```

The seed file is ignored by Git. Do not run the historical restore on every deployment: it could overwrite newer live rows.

## Runtime secrets and current limitation

The original Sites platform returns secret names with masked/null values, so these values cannot be copied out. Until the owner supplies `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID` in Cloudflare Worker secrets, the site serves the migrated snapshot and the API reports `configured: false`. The UI shows that synchronization awaits configuration. Registering the cron alone does not establish a working IBKR connection.

Also configure `TWELVE_DATA_API_KEY` for fresh FX quotes. Without it the existing cached rate is explicitly stale. Optional `IBKR_SYNC_SECRET` and `IBKR_MANUAL_IMPORT_SECRET` authorize administrative endpoints; without secrets those endpoints reject requests (401).

Use `npx wrangler secret put NAME --name the-million-dollar-journey` or the Worker dashboard's runtime Secrets panel. Do not paste secrets into source control or documentation.

## Verification

On 2026-09-16, HTTPS routes `/`, `/en`, `/jade-key`, the bull WebP and portfolio API returned 200; www `/en` redirected with 308; unauthorized synchronization returned 401. Build and 15 targeted tests passed. Existing dependency advisories and inherited UI/data limitations remain in KNOWN_ISSUES.md.
