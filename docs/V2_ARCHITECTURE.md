# v2.0: public investment command center

## Isolation
This branch is a separate private Sites deployment. The production v1 Cloudflare Worker, domain, database and main branch are not modified. Direct Cloudflare deploy/migrate scripts deliberately fail. Sites owns v2 resource binding and applies migrations.

## Data contract
- Broker truth: D1 `portfolio_snapshots`, `portfolio_positions`, `trades`, `sync_runs`.
- Market observations: `live_quotes`, with provider timestamp, ingestion timestamp, currency and explicit entitlement.
- Derived data: `valuation_samples`, `portfolio_sessions`, `live_activity`.
- Operational state: `runtime_state` and expiring `sync_locks`.
- `GET /api/v2/dashboard`: read-only, no upstream synchronization or schema mutation.
- Authenticated `POST /api/v2/sync` and `/api/v2/quotes/refresh`: shared private admin secret, never in the client.
- EOD check: daily 23:30 UTC / 07:30 Beijing. Minute scheduler checks market sessions and configured quote interval; no quotes fetched when the market calendar is closed.

## Estimation and disclosure
USD equity/ETF prices only. Full coverage is mandatory for estimated portfolio NAV; missing/unsupported contracts prevent a complete estimate. Signed quantities preserve shorts. New trades, transfers, fees and corporate actions after the broker snapshot are not included. Day change uses the same holdings marked to the provider previous close, not a cash-flow-adjusted account return.

Freshness alone never confers LIVE status. `QUOTE_ENTITLEMENT=realtime` may only be set after confirming the plan's exchange-data entitlement. Otherwise the feed remains delayed/unknown. The default five-minute polling cadence is not a tick feed; a realtime-entitled quote still loses LIVE status after 90 seconds. No provider key is required to inspect the verified archive, but a working entitled provider is required to complete live-data acceptance.

## Session semantics
Opening NAV means the first value actually observed, not necessarily 09:30. Closing seals need a sample within ten minutes of the regular session close; otherwise the session becomes INCOMPLETE. No artificial interpolation or fabricated historical intraday sample is persisted. Session data is an estimate and is not labelled IBKR verified.

## Calendar and provider references
- NYSE: https://www.nyse.com/markets/hours-calendars
- Twelve Data: https://twelvedata.com/docs
- Twelve Data extended hours: https://support.twelvedata.com/en/articles/5195429-pre-post-market-data

Reviewed regular-session calendar covers 2026–2027 and fails closed outside these years. Unscheduled exchange halts are not inferred from a clock. Provider parsing requires positive USD prices, exact symbol match, valid non-future timestamps; partial failures remain explicit.

## Testing
`npm run test:unit` exercises arithmetic, quote parsing/failures, DST/calendar boundaries, session sealing and baseline journey calculations. `npm run typecheck` validates Cloudflare types. v1 source-string assertions are retained separately as `test:legacy`; they intentionally target v1 markup and must not be interpreted as v2 acceptance.

Pending: integration tests for the D1 lock/sample lifecycle, exact close capture, provider permissions/quotas, complete browser interactions, private hosted data synchronization, and full requirements audit. See V2_PROGRESS.md.
