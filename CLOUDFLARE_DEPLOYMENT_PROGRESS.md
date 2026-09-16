# Cloudflare deployment

- [x] Verify account and Wrangler OAuth.
- [x] Create dedicated D1 database (million-dollar-journey).
- [x] Add explicit Cloudflare build target and custom domains.
- [x] Apply schema and import all 222 validated rows.
- [x] Build, pass 15 targeted tests and deploy Worker.
- [x] Verify HTTPS, bilingual pages, data API, assets, www redirect and unauthenticated admin rejection.
- [x] Connect GitHub main to Cloudflare Builds; use Cloudflare build target and disable non-production deployments.
- [ ] Configure IBKR runtime credentials (original Sites secrets are not readable).

Target: openinvestai.com, with www redirecting to the root domain. Existing Sites deployment is retained. Exported portfolio data is through 2026-09-14. No new IBKR credentials have been generated.

Initial deployment version: 707d30d7-495a-41f1-97e3-f751914422ab. Daily cron registered. GitHub Mobile verification completed by the owner. Cloudflare Builds is connected to AlibabaOpenSesame/TheMillionDollarJourney on main. IBKR and fresh FX secrets are not available from the original hosting platform.
