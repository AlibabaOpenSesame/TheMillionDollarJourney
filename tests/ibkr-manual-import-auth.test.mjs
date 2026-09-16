import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps manual portfolio imports behind a dedicated secret", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(worker, /IBKR_MANUAL_IMPORT_SECRET\?: string/);
  assert.match(worker, /\[env\.IBKR_SYNC_SECRET, env\.IBKR_MANUAL_IMPORT_SECRET\]/);
  assert.match(worker, /if \(!authorized\)/);
});
