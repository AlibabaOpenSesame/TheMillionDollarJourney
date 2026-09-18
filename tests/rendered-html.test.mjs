import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("v1.4.3 locale UX acceptance", async () => {
  const [copy, dashboard, css, pkg, wrangler, layout] = await Promise.all([
    readFile(new URL("app/portfolio-copy.ts", root), "utf8"),
    readFile(new URL("app/PortfolioDashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);
  assert.match(copy, /待接入自动同步/);
  assert.match(copy, /Connect auto-sync/);
  assert.match(copy, /snapshotBadge: "快照"/);
  assert.match(copy, /snapshotBadge: "Snapshot"/);
  assert.match(dashboard, /snapshot-badge/);
  assert.match(dashboard, /\$10,000/);
  assert.match(dashboard, /weeklyPulse\(/);
  assert.match(css, /snapshot-badge/);
  assert.match(pkg, /"version": "1.4.1"/);
  assert.match(wrangler, /"version": "1.4.1"/);
  assert.match(layout, /favicon\.ico/);
  assert.match(layout, /icon-light-32/);
  assert.match(layout, /prefers-color-scheme/);
  assert.match(layout, /icon-dark-32/);
});
