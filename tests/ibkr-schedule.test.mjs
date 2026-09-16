import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("schedules the IBKR sync every day at 07:30 China Standard Time", async () => {
  const [viteConfig, worker] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(viteConfig, /crons:\s*\["30 23 \* \* \*"\]/);
  assert.match(worker, /async scheduled\(/);
  assert.match(worker, /syncPortfolio\(env(?:,\s*"scheduled")?\)/);
  assert.doesNotMatch(worker, /getUTCDay\(\)/);
});
