import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages the IBKR end-of-day cron trigger", async () => {
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers?.crons, ["30 23 * * 1-5"]);
});

test("records trigger provenance and exposes catch-up synchronization", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /trigger TEXT NOT NULL DEFAULT 'manual'/);
  assert.match(source, /syncPortfolio\(env, "scheduled"\)/);
  assert.match(source, /syncPortfolio\(env, "recovery"\)/);
  assert.match(source, /latestScheduledAt/);
  assert.doesNotMatch(source, /ctx\.waitUntil\(syncPortfolio\(env\)\.catch/);
});

test("scheduled failures reject after recording a failed run", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const statements = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          statements.push({ sql: this.sql, args: this.args });
          return { meta: { last_row_id: 1 } };
        },
      };
      return statement;
    },
    async batch() {},
  };

  await assert.rejects(
    () => worker.scheduled(
      { cron: "30 23 * * 1-5", scheduledTime: Date.UTC(2026, 7, 21, 23, 30) },
      { DB: db },
    ),
    /IBKR Flex token or query ID is not configured/,
  );
  assert.ok(statements.some(({ sql, args }) =>
    sql.includes("INSERT INTO sync_runs") && args.includes("scheduled")));
  assert.ok(statements.some(({ sql, args }) =>
    sql.includes("UPDATE sync_runs SET completed_at") && args.includes("IBKR Flex token or query ID is not configured")));
});
