import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("schedules dual weekday UTC crons with NY 18:00 DST guard", async () => {
  const [wrangler, worker, ibkr] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/ibkr.ts", import.meta.url), "utf8"),
  ]);
  assert.match(wrangler, /"30 22 \* \* 1-5"/);
  assert.match(wrangler, /"30 23 \* \* 1-5"/);
  assert.match(worker, /isCorrectNYSyncTime/);
  assert.match(worker, /syncPortfolio\(env,\s*"scheduled"\)/);
  assert.match(ibkr, /America\/New_York/);
  assert.match(ibkr, /hour === 18/);
});
