# OpenInvest AI · v2.0

**A public, verifiable investment journey.**

百万美元之路：$1,000 → $1,000,000。以可核验 IBKR 日终记录为事实层，以行情估算为观察层的中英双语投资系统。

## Deployment boundary

This is the isolated `codex/v2.0` branch. **Do not merge to main or deploy to openinvestai.com.** Version 1 stays unchanged. v2 uses its own owner-private Sites project and database. Direct Cloudflare deployment commands are deliberately disabled.

The new site is not yet released; deployment evidence will be recorded in V2_PROGRESS.md. A local preview does not prove hosted synchronization or live quote entitlement.

## What changes in v2

- Verified NAV and estimated portfolio value remain separate, with source timestamps.
- Explicit LIVE, DELAYED, STALE, SYNCING, ESTIMATED and market-closed states; unavailable data never becomes a simulated live number.
- Persistent activity stream, six performance ranges (1D / 7D / 1M / 3M / YTD / ALL), per-digit update feedback, provenance disclosures.
- Holdings, allocation, portfolio pulse, risk context, milestone narrative and daily session archive.
- Daily sessions store first/current/high/low observations and become SEALED only with adequate closing coverage; incomplete collection is labelled INCOMPLETE.
- Chinese and English, responsive layout, local-time day/night styling and reduced-motion support.

## Local development

Node.js 22.13+ and npm are required.

```sh
npm ci
npm run dev
npm run typecheck
npm run test:unit
npm run build
```

The local database must receive all migrations in `drizzle/`. The application reads a clearly labelled archived baseline until its isolated D1 is populated. Browser GET requests do not initiate broker synchronization or mutate schemas.

## Server configuration

Configure secrets in the **v2 Sites environment**, not GitHub or the client bundle:

| Name | Purpose |
| --- | --- |
| IBKR_FLEX_TOKEN | Read-only Flex token |
| IBKR_FLEX_QUERY_ID | The selected Flex query |
| IBKR_SYNC_SECRET | Private authorization for administrative refresh/bootstrap |
| TWELVE_DATA_API_KEY | Market quote provider |
| QUOTE_ENTITLEMENT | unknown by default; realtime only after verifying exchange entitlement |
| QUOTE_INTERVAL_SECONDS | 300 by default, bounded to 60–900 seconds |

No trading endpoint is implemented. No key should appear in a browser request, URL or committed source.

## Data and limitations

`data/v2-baseline/` is a read-only export of the previous Cloudflare database, taken 2026-09-18. Its manifest records provenance and counts. The latest verified statement is 2026-09-16. It contains no simulated quotes or activity. The earlier `data/export/` migration archive remains unchanged.

Estimated value = last confirmed USD equity/ETF quantities × observed quotes + confirmed cash. Unsupported instruments or missing coverage prevent a full estimate. Unsynced trades, transfers, fees and corporate actions can cause differences. Quote previous-close comparisons and fixed-$1K growth are **not cash-flow-adjusted investment returns**.

Regular-session calendar is reviewed for 2026–2027, including holidays and early closes. Unknown years fail closed; unscheduled exchange halts are not inferred from the clock. Minute scheduler observes market/refresh limits; IBKR EOD check remains 07:30 Beijing. Provider plan limits and redistribution permissions must be confirmed before a public live feed.

## Quality and status

See [V2_PROGRESS.md](V2_PROGRESS.md) for requirement-by-requirement progress and [architecture](docs/V2_ARCHITECTURE.md) for data contracts. `test:legacy` retains v1 source-string assertions and is not v2 acceptance. v2 acceptance includes pure-function tests, actual API/database lifecycle checks, responsive browser interactions and hosted deployment verification.

Changes are committed on `codex/v2.0`; main and v1 release tags remain unchanged. Publish a v2 release only after the full acceptance checklist passes.

This is a personal investment record, not investment advice.
