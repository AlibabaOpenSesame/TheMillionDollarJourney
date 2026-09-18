import assert from "node:assert/strict";
import test from "node:test";
import { marketSession } from "../app/live/market.ts";
import { estimatePortfolio, quoteState } from "../app/live/valuation.ts";
import { evolveSession, sealSession } from "../app/live/session.ts";
import { parseQuote, fetchQuotes } from "../worker/quotes.ts";
import { verifiedFallbackPortfolio } from "../app/portfolio-data.ts";
import type { Quote } from "../app/live/types.ts";

const now = new Date("2026-09-18T15:00:00Z");
const market = marketSession(now);
const portfolio = { ...verifiedFallbackPortfolio, asOf: "2026-09-17", totalCash: 10,
  positions: [{ ...verifiedFallbackPortfolio.positions[0], quantity: 2, symbol: "TEM" }] };
const quote: Quote = { symbol: "TEM", price: 50, previousClose: 40, currency: "USD", quotedAt: now.toISOString(), receivedAt: now.toISOString(), source: "Test fixture", entitlement: "realtime" };

test("calendar respects NY DST, weekend, holidays, early close and unsupported year", () => {
  assert.equal(market.state, "OPEN");
  assert.equal(market.opensAt, "2026-09-18T13:30:00.000Z");
  assert.equal(marketSession(new Date("2026-12-01T15:00:00Z")).opensAt, "2026-12-01T14:30:00.000Z");
  assert.equal(marketSession(new Date("2026-09-19T15:00:00Z")).state, "CLOSED");
  assert.equal(marketSession(new Date("2026-11-26T15:00:00Z")).state, "CLOSED");
  assert.equal(marketSession(new Date("2026-11-27T18:01:00Z")).state, "CLOSED");
  assert.equal(marketSession(new Date("2029-09-18T15:00:00Z")).state, "UNKNOWN");
});
test("estimate is signed holdings plus cash, with same-holdings prior close comparison", () => {
  const value = estimatePortfolio(portfolio, [quote], market, now);
  assert.equal(value.value, 110); assert.equal(value.change, 20); assert.equal(value.state, "ESTIMATED");
  assert.equal(estimatePortfolio({ ...portfolio, positions: [{ ...portfolio.positions[0], quantity: -2 }] }, [quote], market, now).value, -90);
});
test("missing quotes, unsupported contracts and currency prevent a complete estimate", () => {
  assert.equal(estimatePortfolio(portfolio, [], market, now).value, null);
  assert.equal(estimatePortfolio({ ...portfolio, positions: [{ ...portfolio.positions[0], assetClass: "OPT" }] }, [quote], market, now).value, null);
  assert.equal(estimatePortfolio({ ...portfolio, currency: "CNY" }, [quote], market, now).value, null);
});
test("live entitlement is never inferred from freshness, and stale quotes stay stale", () => {
  assert.equal(quoteState(quote, now, market), "LIVE");
  assert.equal(quoteState({ ...quote, entitlement: "unknown" }, now, market), "DELAYED");
  assert.equal(quoteState({ ...quote, quotedAt: "2026-09-18T14:00:00Z" }, now, market), "STALE");
  assert.equal(quoteState({ ...quote, quotedAt: "2026-09-19T14:00:00Z" }, now, market), "UNAVAILABLE");
});
test("missing prior close leaves day P/L unknown rather than zero", () => {
  assert.equal(estimatePortfolio(portfolio, [{ ...quote, previousClose: null }], market, now).change, null);
});
test("session preserves first observation, high/low, and seals only after close", () => {
  let s = evolveSession(null, "2026-09-18", 100, "2026-09-17", now.toISOString(), 1);
  s = evolveSession(s, s.date, 110, s.snapshotDate, "2026-09-18T19:55:00Z", 2);
  assert.equal(s.openingNav, 100); assert.equal(s.high, 110); assert.equal(s.low, 100); assert.equal(s.events, 3);
  assert.equal(sealSession(s, new Date("2026-09-18T19:59:00Z")).status, "RUNNING");
  const sealed = sealSession(s, new Date("2026-09-18T20:01:00Z"));
  assert.equal(sealed.status, "SEALED");
  assert.equal(evolveSession(sealed, sealed.date, 120, sealed.snapshotDate, "2026-09-18T20:02:00Z", 1).current, 110);
  assert.equal(sealSession({ ...s, updatedAt: now.toISOString() }, new Date("2026-09-18T20:01:00Z")).status, "INCOMPLETE");
});
test("provider parser rejects mismatch, missing price and future timestamp", () => {
  const raw = { symbol: "TEM", currency: "USD", close: "50", previous_close: "40", timestamp: now.getTime() / 1000 };
  assert.equal(parseQuote(raw, "TEM", now.toISOString(), "unknown").price, 50);
  assert.throws(() => parseQuote({ ...raw, symbol: "OTHER" }, "TEM", now.toISOString(), "unknown"));
  assert.throws(() => parseQuote({ ...raw, close: null }, "TEM", now.toISOString(), "unknown"));
  assert.throws(() => parseQuote({ ...raw, timestamp: raw.timestamp + 3600 }, "TEM", now.toISOString(), "unknown"));
});
test("late receipts cannot turn delayed close quotes into complete sessions", () => {
  const session = evolveSession(null, "2026-09-18", 100, "2026-09-17", "2026-09-18T19:40:00Z", 1);
  const sealed = sealSession(session, new Date("2026-09-18T20:01:00Z"));
  assert.equal(sealed.status, "INCOMPLETE");
  assert.equal(evolveSession(sealed, sealed.date, 120, sealed.snapshotDate, "2026-09-18T20:02:00Z", 1), sealed);
  assert.equal(evolveSession(session, session.date, 90, session.snapshotDate, "2026-09-18T19:35:00Z", 1), session);
  assert.equal(sealSession({ ...session, updatedAt: "2026-09-18T20:05:00Z" }, new Date("2026-09-18T20:10:00Z")).status, "INCOMPLETE");
});
test("provider partial failure preserves coverage and never leaks credentials into the URL", async () => {
  const fake = (async (input: URL | RequestInfo, options?: RequestInit) => {
    const url = String(input); assert.ok(!url.includes("secret")); assert.ok(options?.signal);
    return url.includes("symbol=TEM") ? Response.json({ symbol: "TEM", currency: "USD", close: "50", previous_close: "40", timestamp: now.getTime() / 1000 }) : Response.json({ status: "error" }, { status: 429 });
  }) as typeof fetch;
  const response = await fetchQuotes(["TEM", "LFMD", "TEM"], "secret", "unknown", fake, now);
  assert.equal(response.quotes.length, 1); assert.deepEqual(response.failed, ["LFMD"]);
});
