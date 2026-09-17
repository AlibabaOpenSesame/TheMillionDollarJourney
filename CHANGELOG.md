# Changelog

## [Unreleased]

## [1.2.0] - 2026-09-17

- Locale-split UX: Chinese `/` and English `/en` copy edited independently (no shared calque).
- Underwater ruler ends show `$current → $10K`; jade-key cloud-bow favicon for Chrome tabs/bookmarks.
- Demoted bilingual subtitles; EN table header abbreviations; risk strip above holdings; contact leads with X.


## [1.1.0] - 2026-09-17

- Underwater UX: CURRENT stays neutral (white/light gray) below $10K; daily P/L green/red stays independent.
- USD is the primary currency sitewide; CNY appears only as a secondary `约 ¥…` line under CURRENT.
- Top bar uses two chips: `数据 · MM-DD HH:mm` and `需授权自动同步→`.
- First screen keeps the break-even ruler (`回本 · 还差 $X`), drops journey-progress %, and adds a weekly pulse line.


- Deploy directly to Cloudflare Workers and dedicated D1 at openinvestai.com.
- Add www-to-apex redirect, daily 07:30 Beijing cron and dual hosting build targets.
- Add complete D1-compatible export file generation and production deployment documentation.
- Correct sync status when migrated data exists but IBKR secrets are not configured.

## [1.0.0] - 2026-09-16

- Publish Sites v33 source baseline (`214a33541df0dd3f1de40be149239910f2712174`).
- Include bilingual investment dashboard, journey metrics, running-bull sprite, company logos, contacts and 3D jade-key page.
- Export all available production rows from four D1 tables; latest portfolio date 2026-09-14.
- Add README, provenance, known issues, data validation/restore tools and CI.
- Start clean public history, excluding runtime credentials and private history.

Sites v33 introduced the running-bull cycle. Sites versions and GitHub semantic versions are separate sequences. Earlier development history remains in the private source repository.
