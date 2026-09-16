import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the existing Chinese IBKR dashboard at the root route", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /百万美元之路/);
  assert.match(html, /丁小山美股公开投资/);
  assert.match(html, /\$10,000 → \$1,000,000/);
  assert.match(html, /资产配置/);
  assert.match(html, /净值曲线/);
  assert.match(html, /journey-bull-v1\.webp/);
  assert.match(html, /journey-bull-run-v2\.webp/);
  assert.match(html, /journey-bull-run-sprite/);
  assert.match(html, /journey-progress-rail/);
  assert.match(html, /实时汇率/);
  assert.match(html, /正在获取 USD\/CNY/);
  assert.match(html, /当前持仓/);
  assert.match(html, /联系方式/);
  assert.match(html, /people@china\.com/);
  assert.match(html, /\+86 199 5167 7665/);
  assert.match(html, /0288882@gmail\.com/);
  assert.match(html, /x\.com\/languagemodelAI/);
  assert.match(html, /呼号/);
  assert.match(html, /BD4WUC/);
  assert.match(html, /每天北京时间 07:30 执行/);
  assert.match(html, /href="\/en"/);
  assert.match(html, /aria-current="page"[^>]*>中文</);
});

test("renders a fully localized English IBKR dashboard at /en", async () => {
  const response = await render("/en");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /The Million Dollar Journey/);
  assert.match(html, /Ding Xiaoshan U\.S\. Public Equity Portfolio/);
  assert.match(html, /Asset Allocation/);
  assert.match(html, /Net Asset Curve/);
  assert.match(html, /journey-bull-v1\.webp/);
  assert.match(html, /journey-bull-run-v2\.webp/);
  assert.doesNotMatch(html, /实时汇率/);
  assert.match(html, /Transactions &amp; P&amp;L/);
  assert.match(html, /Current Holdings/);
  assert.match(html, /Option Positions/);
  assert.match(html, /Contact/);
  assert.match(html, /United States/);
  assert.match(html, /\+1 980 999 0101/);
  assert.match(html, /0288882@gmail\.com/);
  assert.match(html, /@languagemodelAI/);
  assert.match(html, /Call Sign/);
  assert.match(html, /Runs every day at 07:30 China Standard Time/);
  assert.match(html, /href="\/"/);
  assert.match(html, /aria-current="page"[^>]*>English</);
});
