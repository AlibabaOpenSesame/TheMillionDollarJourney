# Known issues inherited from Sites v33

- Daily 07:30 Beijing scheduling is configured, but exported history contains manual/import/recovery runs rather than proof of reliable scheduled execution. A GitHub copy does not operate or repair that schedule.
- An open page may need reload after synchronization; the dashboard fetches on mount.
- Bundled historical fallback can appear before live data and remains without backend configuration.
- Short-period realized P&L lacks a complete transaction ledger; some zero values mean unavailable data.
- Mobile chart-grid minimum sizing can produce horizontal overflow.
- `tests/ibkr-sync-schedule.test.mjs` expects obsolete weekday-only cron; `tests/ibkr-schedule.test.mjs` checks the current daily requirement.
- `tests/rendered-html.test.mjs` checks removed starter content. It is excluded from targeted unit tests; the original command remains and can fail.
- Root bundle/font loading and header-derived metadata origins need further review.
- On 2026-09-16, `npm audit --omit=dev` reported 5 production dependency advisories (1 moderate, 3 high, 1 critical), involving Next.js and transitive packages. The v33 lockfile is preserved apart from project naming/version metadata. Dependency remediation requires a separate tested upgrade before treating a new deployment as hardened.

Issues are documented rather than silently changing the production baseline during migration. Export validation and targeted tests cover only their stated scopes.
