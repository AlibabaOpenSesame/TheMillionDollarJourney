import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function sources() {
  const [copy, dashboard, currency, css] = await Promise.all([
    readFile(new URL("app/portfolio-copy.ts", root), "utf8"),
    readFile(new URL("app/PortfolioDashboard.tsx", root), "utf8"),
    readFile(new URL("app/currency.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  return { copy, dashboard, currency, css };
}

test("Chinese locale copy locks underwater ruler + sync chips + weekly pulse", async () => {
  const { copy, dashboard } = await sources();
  assert.match(copy, /百万美元之路/);
  assert.match(copy, /回本 · 还差 \$\{value\}/);
  assert.match(copy, /weeklyPulseUnderwater/);
  assert.match(copy, /weeklyPulseOnJourney/);
  assert.match(copy, /已过 \$1K 起点/);
  assert.match(copy, /dataChip: "数据"/);
  assert.match(copy, /snapshotBadge: "快照"/);
  assert.match(copy, /connectCta: "待接入自动同步"/);
  assert.match(copy, /routeStart: "起点"/);
  assert.match(dashboard, /formatCnyApprox/);
  assert.match(dashboard, /underwater/);
  assert.match(dashboard, /\$1,000/);
  assert.match(dashboard, /JOURNEY_START_VALUE/);
  assert.match(dashboard, /snapshot-badge/);
  assert.match(dashboard, /connectCta/);
  assert.doesNotMatch(dashboard, /旅程进度/);
});

test("English locale copy is independent (not a ZH mirror)", async () => {
  const { copy } = await sources();
  assert.match(copy, /The Million Dollar Journey/);
  assert.match(copy, /Break-even · \$\{value\} to go/);
  assert.match(copy, /Still ~\$\{gap\} below the \$1k start/);
  assert.match(copy, /Past the \$1k start/);
  assert.match(copy, /dataChip: "Data"/);
  assert.match(copy, /snapshotBadge: "Snapshot"/);
  assert.match(copy, /connectCta: "Connect auto-sync"/);
  assert.match(copy, /Value \/ Wt/);
  assert.match(copy, /Unreal\./);
  assert.match(copy, /routeStart: "START"/);
});

test("money view stays USD-primary with optional CNY approx line", async () => {
  const { currency, dashboard } = await sources();
  assert.match(currency, /createMoneyView/);
  assert.match(currency, /formatCnyApprox/);
  assert.match(dashboard, /current-cny-approx|cnyApprox/);
});

test("header key mark stays full horizontal jade key (not favicon crop)", async () => {
  const { dashboard, css } = await sources();
  assert.match(dashboard, /cloud-jade-key-mark-v3\.webp/);
  assert.match(dashboard, /journey-key-mark/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /snapshot-badge/);
});
