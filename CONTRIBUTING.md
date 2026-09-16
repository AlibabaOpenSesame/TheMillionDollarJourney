# Contributing and releases

1. Branch from `main` using `codex/<topic>` or a descriptive feature branch.
2. Keep code and data in separate commits. Use `feat`, `fix`, `docs`, `data`, `chore` prefixes.
3. Run `npm ci`, `npm run data:validate`, `npm run build`, then `npm run test:unit` (bilingual rendering tests need the build output).
4. Explain results and validation in a pull request; retain documented inherited issues until fixed.
5. Update changelog, package version and lockfile for releases. Tag approved commits `vMAJOR.MINOR.PATCH`; never rewrite published tags.

Exports must preserve source timestamps and include all table counts. Never commit secrets, raw Flex XML, account identifiers, private keys or request logs. Do not call a snapshot a live feed.

GitHub is the public source archive. Pushing here does not automatically update the Sites website or its database.
