import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("v1.3.0 locale-split, favicon, and worker evolve acceptance", async () => {
  const [copy, dashboard, css, pkg, wrangler, layout, ibkr, cache] = await Promise.all([
    readFile(new URL("app/portfolio-copy.ts", root), "utf8"),
    readFile(new URL("app/PortfolioDashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("worker/ibkr.ts", root), "utf8"),
    readFile(new URL("worker/cache.ts", root), "utf8"),
  ]);

  assert.match(copy, /routeStart/);
  assert.match(copy, /Still ~\$7\.3k below the \$10k start/);
  assert.match(copy, /Value \/ Wt/);
  assert.match(copy, /unavailableUnderCurrent/);
  assert.match(dashboard, /const leftEnd/);
  assert.match(dashboard, /const rightEnd/);
  assert.match(dashboard, /journey-alternate-title demoted/);
  assert.match(css, /journey-alternate-title\.demoted/);
  assert.match(css, /milestone-pill/);
  assert.match(pkg, /"version": "1\.3\.0"/);
  assert.match(wrangler, /"version": "1\.3\.0"/);
  assert.match(wrangler, /"binding": "CACHE"/);
  assert.match(layout, /favicon\.ico/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.doesNotMatch(layout, /favicon\.svg/);
  assert.match(ibkr, /fetchIbkrFlex/);
  assert.match(cache, /portfolio:latest/);
  assert.match(cache, /positions:latest/);
  assert.match(cache, /sync:status/);
});
