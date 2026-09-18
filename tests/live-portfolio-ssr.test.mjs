import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("SSR pages load live portfolio before render", async () => {
  const [zh, en, loader, dashboard, copy, pkg] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/en/page.tsx", root), "utf8"),
    readFile(new URL("app/load-portfolio.ts", root), "utf8"),
    readFile(new URL("app/PortfolioDashboard.tsx", root), "utf8"),
    readFile(new URL("app/portfolio-copy.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  assert.match(zh, /force-dynamic/);
  assert.match(zh, /loadPortfolio/);
  assert.match(zh, /async function Home/);
  assert.match(en, /force-dynamic/);
  assert.match(en, /loadPortfolio/);
  assert.match(en, /async function EnglishDashboard/);
  assert.match(loader, /\/api\/portfolio/);
  assert.match(loader, /usingFallback/);
  assert.match(loader, /verifiedFallbackPortfolio/);
  assert.match(dashboard, /initial: LoadedPortfolio/);
  assert.match(dashboard, /notLiveBadge/);
  assert.match(copy, /notLiveBadge: "非实时"/);
  assert.match(copy, /notLiveBadge: "Not live"/);
  assert.match(pkg, /"version": "1.5.1"/);
  assert.doesNotMatch(zh, /verifiedFallbackPortfolio/);
  assert.doesNotMatch(en, /verifiedFallbackPortfolio/);
});
