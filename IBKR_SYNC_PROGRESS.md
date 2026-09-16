# IBKR synchronization repair

- [x] Confirm production portfolio stopped at 2026-08-14.
- [x] Confirm production is missing `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID`.
- [x] Add scheduled/manual/recovery/import provenance to synchronization runs.
- [x] Make scheduled failures visible to the production cron runtime.
- [x] Add a page-open catch-up path if a production cron cycle is missed.
- [x] Build the production bundle and pass the dedicated synchronization tests.
- [ ] Create or verify the read-only IBKR Flex query and one-year token.
- [ ] Store both values in encrypted Sites environment variables.
- [ ] Deploy and complete a live synchronization smoke test.
