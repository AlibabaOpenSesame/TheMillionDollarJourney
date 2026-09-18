# OpenInvest AI v2.0 delivery tracker

## Safety boundary
- Baseline: GitHub main 0e7160cad62c78cd5ab1d5e358d975f5fab1e086 (v1.6.0).
- Worktree: TheMillionDollarJourney-v2; branch codex/v2.0.
- Do not merge main, deploy to openinvestai.com, or write the v1 database.
- Register a new private Sites project with independent DB. The inherited Sites identity has deliberately been cleared ONLY in this v2 branch because v1 must remain unchanged.
- No fabricated market quotes, activity, transaction rows, or successful synchronization states.

## Requirements / evidence
- [x] Read full user attachment and inspect existing source/hosting.
- [x] Create isolated v2 branch and checkout.
- [x] Separate Sites identity registered: appgprj_6aaced7155cc8191bd10abffae2329ba. Remote deployment/storage migration still pending.
- [ ] Verified NAV and estimated market valuation with explicit timestamps.
- [ ] LIVE / ESTIMATED / VERIFIED / SYNCING / DELAYED / STALE / CLOSED states.
- [ ] Persisted activity stream, newest first, based on observed events only.
- [ ] 1D / 7D / 1M / 3M / YTD / ALL performance chart.
- [ ] Changed-digit animations, endpoint pulse and reduced-motion behavior.
- [ ] Data provenance on all financial surfaces.
- [ ] Portfolio Pulse: exposure, concentration, cash, movers, range.
- [ ] Journey milestones with verified crossing dates.
- [ ] Daily sessions with opening/current/P&L/high/low/events and sealed history.
- [ ] Verified history / trades / notes with honest empty states.
- [ ] Bilingual responsive command-center design and existing branding/contact assets.
- [ ] Isolated quote provider integration and safe credential configuration.
- [ ] Behavior tests, production build, browser verification.
- [ ] GitHub v2 branch, version docs, independent Sites deployment verified.

## Decisions
- Keep $1K→$1M baseline from v1.6.0, but label baseline growth separately from investment returns.
- Quotes never overwrite the broker snapshot. Partial quote coverage prevents full estimated NAV.
- An unavailable feed is visibly unavailable, not a simulated LIVE feed.
- Session seals represent observed market estimates, not broker-verified EOD statements.

## Current
First coherent preview available at localhost:3001. Isolated local D1 migrations 0000–0004 applied. 8 new domain/provider/session tests pass; TypeScript check passes. The inherited Drizzle metadata omitted previously applied 0002/0003 changes: the new, unapplied 0004 migration was reviewed and duplicate trades/trigger statements removed; old migrations were not changed.

Backend quote collection, read-only API, locks and session lifecycle are implemented but still need integration verification. No v2 site has been published. Credentials and real quote entitlement remain to be validated; do not mark completion until deployment and full requirement audit succeed.
