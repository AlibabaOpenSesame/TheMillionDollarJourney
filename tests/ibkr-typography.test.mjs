import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);

test("defines a bilingual financial typography system", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(css, /--font-ui:\s*var\(--font-geist-sans\),\s*var\(--font-noto-sc\)/);
  assert.match(css, /--font-finance:/);
  assert.match(css, /--font-technical:/);
  assert.match(css, /font-synthesis:\s*none/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums lining-nums/);
  assert.match(css, /main:lang\(zh-CN\) h1/);
  assert.match(css, /main:lang\(en\) h1/);
  assert.match(css, /\.data-table td[^}]*font-family:\s*var\(--font-finance\)/s);
  assert.match(css, /\.axis-label[^}]*var\(--font-technical\)/s);
});

test("loads every bundled dashboard font with swap behavior", async () => {
  const layout = await readFile(layoutUrl, "utf8");
  assert.equal((layout.match(/display:\s*"swap"/g) ?? []).length, 3);
  assert.match(layout, /Noto_Sans_SC/);
  assert.match(layout, /Geist_Mono/);
});
