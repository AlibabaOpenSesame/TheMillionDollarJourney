import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("underwater UX acceptance strings are present in source", async () => {
  const [currency, copy, dashboard, css, pkg, wrangler] = await Promise.all([
    readFile(new URL("app/currency.ts", root), "utf8"),
    readFile(new URL("app/portfolio-copy.ts", root), "utf8"),
    readFile(new URL("app/PortfolioDashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
  ]);

  assert.match(currency, /formatCnyApprox/);
  assert.match(currency, /code: "USD"/);
  assert.doesNotMatch(currency, /locale === "zh" && fx/);

  assert.match(copy, /回本 · 还差/);
  assert.match(copy, /需授权自动同步→/);
  assert.match(copy, /weeklyPulse/);
  assert.match(copy, /dataChip/);

  assert.match(dashboard, /data-phase=\{underwater \? "underwater" : "journey"\}/);
  assert.match(dashboard, /header-chip-row/);
  assert.match(dashboard, /journey-weekly-pulse/);
  assert.doesNotMatch(dashboard, /copy\.journey\.progress/);

  assert.match(css, /\.journey-current-value\.underwater strong/);
  assert.match(css, /header-chip-row/);
  assert.match(css, /z-index: 40/);

  assert.match(pkg, /"version": "1\.1\.0"/);
  assert.match(wrangler, /"version": "1\.1\.0"/);
});
