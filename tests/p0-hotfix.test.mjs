import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function listFiles(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = `${dir}${entry.name}`;
    return entry.isDirectory() ? listFiles(`${path}/`) : [path];
  }));
  return files.flat();
}

test("v1.6.1 version is consistent", async () => {
  const [pkg, wrangler, changelog] = await Promise.all([read("package.json"), read("wrangler.jsonc"), read("CHANGELOG.md")]);
  assert.match(pkg, /"version": "1\.6\.1"/);
  assert.match(wrangler, /"version": "1\.6\.1"/);
  assert.match(changelog.split("\n")[0], /^## 1\.6\.1/);
});

test("share image is the static $1K → $1M card and both locales reference it", async () => {
  const [svg, rootLayout, enLayout, siteLocale, png] = await Promise.all([
    read("scripts/og/og.svg"),
    read("app/layout.tsx"),
    read("app/en/layout.tsx"),
    read("app/site-locale.ts"),
    readFile(new URL("public/og.png", root)),
  ]);
  assert.match(svg, /\$1K → \$1M/);
  assert.doesNotMatch(svg, /\$10K/);
  assert.match(svg, /百万美元之路/);
  assert.match(svg, /One Portfolio\. One Journey\./);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.match(siteLocale, /SOCIAL_IMAGE_PATH = "\/og\.png/);
  for (const layout of [rootLayout, enLayout]) {
    assert.match(layout, /SOCIAL_IMAGE_PATH/);
    assert.match(layout, /openGraph:[\s\S]*images:/);
    assert.match(layout, /twitter:[\s\S]*images:/);
  }
  assert.doesNotMatch(rootLayout + enLayout, /\$10K|\$10,000/);
});

test("achieved milestone card uses the high-contrast palette", async () => {
  const [css, dashboard] = await Promise.all([read("app/globals.css"), read("app/PortfolioDashboard.tsx")]);
  assert.match(css, /--gold:\s*#d4af37/i);
  assert.match(css, /\.milestone-card\.milestone-achieved[^{]*\{[^}]*background:\s*#12352a/i);
  assert.match(css, /\.milestone-card\.milestone-achieved > strong[^{]*\{[^}]*color:\s*#e8f5ee/i);
  assert.match(css, /\.milestone-check[^{]*\{[^}]*color:\s*var\(--gold\)/);
  assert.match(dashboard, /milestone-check[^>]*>✓</);
});

test("no phone numbers or personal email addresses anywhere in app/", async () => {
  const files = (await listFiles("app/")).filter((path) => /\.(tsx?|css|mjs|js)$/.test(path));
  assert.ok(files.length > 0);
  for (const path of files) {
    const source = await read(path);
    assert.doesNotMatch(source, /@gmail\.com/i, path);
    assert.doesNotMatch(source, /\+1[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/, path);
    assert.doesNotMatch(source, /\+86[\s.-]?\d{3}/, path);
    assert.doesNotMatch(source, /href="(tel|mailto):/, path);
  }
  const dashboard = await read("app/PortfolioDashboard.tsx");
  assert.match(dashboard, /https:\/\/x\.com\/languagemodelAI/);
});

test("footer carries the anti-scam line and legal links in both locales", async () => {
  const [copy, dashboard] = await Promise.all([read("app/portfolio-copy.ts"), read("app/PortfolioDashboard.tsx")]);
  assert.match(copy, /antiScam: "本人不会私信荐股、拉群或代客理财，冒充者请举报。"/);
  assert.match(copy, /antiScam: "I never DM stock tips, run paid groups, or manage money for others — report impersonators\."/);
  assert.match(copy, /disclaimerPath: "\/disclaimer"/);
  assert.match(copy, /disclaimerPath: "\/en\/disclaimer"/);
  assert.match(copy, /privacyPath: "\/privacy"/);
  assert.match(copy, /privacyPath: "\/en\/privacy"/);
  assert.match(dashboard, /copy\.footer\.antiScam/);
  assert.match(dashboard, /href=\{copy\.disclaimerPath\}/);
  assert.match(dashboard, /href=\{copy\.privacyPath\}/);
  assert.match(copy, /\/\/ COPY: placeholder pending designer final\n\s*antiScam:/);
});

test("risk notice sits under the hero value in both locales, linked to the disclaimer", async () => {
  const [copy, dashboard, css] = await Promise.all([read("app/portfolio-copy.ts"), read("app/PortfolioDashboard.tsx"), read("app/globals.css")]);
  assert.match(copy, /riskNotice: "公开真实账户，持仓高度集中，不构成投资建议。"/);
  assert.match(copy, /riskNotice: "Real public account, highly concentrated\. Not investment advice\."/);
  assert.equal((copy.match(/riskNotice:/g) ?? []).length, 2);
  assert.doesNotMatch(copy.match(/riskNotice: "[^"]*"/g).join(" "), /\d+(\.\d+)?%/);
  assert.match(dashboard, /journey-risk-notice" href=\{copy\.disclaimerPath\}>\{copy\.journey\.riskNotice\}/);
  assert.match(css, /\.journey-risk-notice \{[^}]*font-size:\s*\.75rem/);
});

test("disclaimer + privacy routes exist for both locales", async () => {
  for (const path of ["app/disclaimer/page.tsx", "app/privacy/page.tsx", "app/en/disclaimer/page.tsx", "app/en/privacy/page.tsx"]) {
    await access(new URL(path, root));
    const source = await read(path);
    assert.match(source, /LegalPage/);
    assert.match(source, /legalMetadata\("(zh|en)", "(disclaimer|privacy)"\)/);
  }
  const legal = await read("app/legal-copy.ts");
  for (const heading of ["不构成投资建议", "非持牌投资顾问", "利益冲突披露", "Not investment advice", "Not a licensed advisor", "Conflict of interest", "Cloudflare"]) {
    assert.match(legal, new RegExp(heading));
  }
  assert.ok((legal.match(/\/\/ COPY: placeholder pending designer final/g) ?? []).length >= 4);
});

test("SSR <html lang> follows the locale path", async () => {
  const [proxy, rootLayout, siteLocale, legalPage] = await Promise.all([read("proxy.ts"), read("app/layout.tsx"), read("app/site-locale.ts"), read("app/LegalPage.tsx")]);
  assert.match(siteLocale, /pathname === "\/en" \|\| pathname\.startsWith\("\/en\/"\)/);
  assert.match(proxy, /SITE_LANG_HEADER/);
  assert.match(proxy, /htmlLangForPath/);
  assert.match(rootLayout, /<html lang=\{lang\}>/);
  assert.doesNotMatch(rootLayout, /<html lang="zh-CN">/);
  assert.match(rootLayout, /HtmlLangSync/);
  assert.match(legalPage, /lang=\{copy\.htmlLang\}/);
});
