import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages dual IBKR end-of-day cron triggers", async () => {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(wrangler, /"30 22 \* \* 1-5"/);
  assert.match(wrangler, /"30 23 \* \* 1-5"/);
});

test("records trigger provenance and exposes catch-up synchronization", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /trigger TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(source, /syncPortfolio\(env, "scheduled"\)/);
  assert.match(source, /syncPortfolio\(env, "recovery"\)/);
  assert.match(source, /latestScheduledAt/);
  assert.match(source, /writeLatestCache/);
  assert.doesNotMatch(source, /ctx\.waitUntil\(syncPortfolio\(env\)\.catch/);
});

test("scheduled handler skips when not 18:00 America/New_York", async () => {
  // Aug 21 2026 22:30 UTC = 18:30 EDT → hour 18 → should attempt sync (and fail without secrets).
  // Aug 21 2026 23:30 UTC = 19:30 EDT → hour 19 → should skip before syncPortfolio.
  const ibkrUrl = new URL("../worker/ibkr.ts", import.meta.url);
  ibkrUrl.searchParams.set("t", `${process.pid}-guard`);
  const { isCorrectNYSyncTime } = await import(ibkrUrl.href);

  assert.equal(isCorrectNYSyncTime(new Date(Date.UTC(2026, 7, 21, 22, 30))), true);
  assert.equal(isCorrectNYSyncTime(new Date(Date.UTC(2026, 7, 21, 23, 30))), false);
  // Jan (EST): 23:30 UTC = 18:30 EST
  assert.equal(isCorrectNYSyncTime(new Date(Date.UTC(2026, 0, 21, 23, 30))), true);
  assert.equal(isCorrectNYSyncTime(new Date(Date.UTC(2026, 0, 21, 22, 30))), false);
});
