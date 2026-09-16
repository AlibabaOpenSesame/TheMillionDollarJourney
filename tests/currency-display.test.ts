import assert from "node:assert/strict";
import test from "node:test";
import { createMoneyView } from "../app/currency.ts";
import { parseTwelveDataRate, resolveUsdCnyRate, type StoredFxRate } from "../worker/fx.ts";

const cachedRate: StoredFxRate = {
  pair: "USD/CNY",
  rate: 7.2,
  quotedAt: "2026-08-17T01:00:00.000Z",
  fetchedAt: "2026-08-17T01:00:00.000Z",
  source: "Twelve Data",
};

test("converts every Chinese monetary value to CNY while English remains USD", () => {
  const quote = { ...cachedRate, status: "live" as const };
  const chinese = createMoneyView("zh", quote);
  const english = createMoneyView("en", quote);

  assert.equal(chinese.code, "CNY");
  assert.equal(chinese.convert(100), 720);
  assert.equal(chinese.format(100), "¥720.00");
  assert.equal(chinese.signed(-10), "−¥72.00");
  assert.equal(english.code, "USD");
  assert.equal(english.convert(100), 100);
  assert.equal(english.format(100), "$100.00");
});

test("falls back to explicit USD formatting when no valid CNY rate exists", () => {
  const view = createMoneyView("zh", null);
  assert.equal(view.code, "USD");
  assert.equal(view.convert(100), 100);
  assert.match(view.format(100), /100\.00/);
});

test("validates Twelve Data rates and timestamps", () => {
  const timestamp = Date.parse("2026-08-17T01:30:00.000Z") / 1000;
  const parsed = parseTwelveDataRate({ rate: "7.1452", timestamp }, "2026-08-17T02:00:00.000Z");
  assert.equal(parsed.rate, 7.1452);
  assert.equal(parsed.quotedAt, "2026-08-17T01:30:00.000Z");
  assert.throws(() => parseTwelveDataRate({ rate: 0 }, "2026-08-17T02:00:00.000Z"), /Invalid USD\/CNY rate/);
  assert.throws(() => parseTwelveDataRate({ rate: 7.1 }, "2026-08-17T02:00:00.000Z"), /Invalid FX timestamp/);
});

test("reuses fresh cache and keeps stale cache when the provider fails", async () => {
  let calls = 0;
  const fresh = await resolveUsdCnyRate(cachedRate, "secret", async () => {
    calls += 1;
    throw new Error("should not fetch");
  }, new Date("2026-08-17T01:04:00.000Z"));
  assert.equal(fresh.quote.status, "live");
  assert.equal(calls, 0);

  const stale = await resolveUsdCnyRate(cachedRate, "secret", async () => {
    calls += 1;
    throw new Error("provider unavailable");
  }, new Date("2026-08-17T01:10:00.000Z"));
  assert.equal(stale.quote.status, "stale");
  assert.equal(stale.quote.rate, 7.2);
  assert.equal(calls, 1);
});

test("fetches a new rate securely and reports unavailable without key or cache", async () => {
  const resolved = await resolveUsdCnyRate(null, "secret", async (input, init) => {
    assert.match(String(input), /exchange_rate\?symbol=USD%2FCNY/);
    assert.equal(new Headers(init?.headers).get("authorization"), "apikey secret");
    return Response.json({ rate: 7.25, timestamp: Date.parse("2026-08-17T01:59:00.000Z") / 1000 });
  }, new Date("2026-08-17T02:00:00.000Z"));
  assert.equal(resolved.quote.status, "live");
  assert.equal(resolved.quote.rate, 7.25);
  assert.ok(resolved.recordToStore);

  const unavailable = await resolveUsdCnyRate(null, undefined, undefined, new Date("2026-08-17T02:00:00.000Z"));
  assert.equal(unavailable.quote.status, "unavailable");
  assert.equal(unavailable.quote.rate, null);
});
