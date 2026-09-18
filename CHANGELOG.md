# Changelog

## 1.5.0 — Live portfolio first paint

- ZH `/` and EN `/en` SSR load live `/api/portfolio` for first paint (NAV / positions / asOf)
- Bundled `verifiedFallbackPortfolio` only when live read fails/empty; UI shows **非实时** / **Not live**
- Client still refreshes via `/api/portfolio`; no layout redesign

## 1.4.3 — Favicon head-down + system backgrounds

- Full mark-v3 rotated 90° CCW (jade head down, teeth up)
- Light `#F3F5F7` / dark `#000` icon sets via `prefers-color-scheme`; `favicon.ico` dark fallback
- Jade-key page untouched

## 1.4.2 — Favicon vertical full key

- Full `cloud-jade-key-mark-v3` rotated 90° CW (head up, teeth down) on solid `#000`
- ~65% content / ≥17% margin; `favicon.ico` 16/32/48 + icon-32/192 + apple-touch 180
- Jade-key page untouched

## 1.4.1 — Favicon complete jade cloud head

- Crop left jade-cloud head from `cloud-jade-key-mark-v3`, scale to ~72% on black square, ≥14% margin (gold frame fully visible)
- `favicon.ico` 16/32/48, `icon-32.png`, `icon-192.png`, `apple-touch-icon.png`
- Layout paths unchanged; jade-key page untouched


## 1.4.0 — Locale UX (no live IBKR required)

- ZH/EN independent: unconfigured CTA `待接入自动同步` / `Connect auto-sync` (no fake authorize)
- Data chip binds `updatedAt`/`asOf`; muted **快照** / **Snapshot** badge when stale or unconfigured
- Weekly pulse uses live gap to $10k; START stays `$10,000`; underwater KPIs stay two cards
- 390: clip horizontal overflow; chips stay 32px; key 28px full mark

## 1.3.0 — IBKR D1+KV evolve

- Extract `worker/ibkr.ts` (Flex v3 SendRequest/GetStatement + parse, NY 18:00 DST guard)
- Add `worker/cache.ts` — KV keys `portfolio:latest` / `positions:latest` / `sync:status` only
- Bind existing Worker to KV `OPENINVEST_CACHE` as `CACHE`; D1 remains `million-dollar-journey` (SoT)
- Migration `0003_trades` (+ journal entry for `0002_sync_run_trigger`)
- Dual weekday crons `30 22/23 * * 1-5` UTC; skip unless America/New_York hour is 18
- Frontend unchanged

## [Unreleased]

## [1.2.1] - 2026-09-17

- Header shows the full horizontal jade key (`cloud-jade-key-mark-v3.webp`); square crop stays favicon-only.
- START/起点 column always `$10,000`; ruler ends remain `$current → $10K`.


## [1.2.0] - 2026-09-17

- Locale-split UX: Chinese `/` and English `/en` copy edited independently (no shared calque).
- Underwater ruler ends show `$current → $10K`; jade-key cloud-bow favicon for Chrome tabs/bookmarks.
- Demoted bilingual subtitles; EN table header abbreviations; risk strip above holdings; contact leads with X.
- Responsive: 1200 / 768–1199 / ≤767 / ≤390 — chips above key, underwater ruler, sticky holdings cols, 44px touch targets.


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
