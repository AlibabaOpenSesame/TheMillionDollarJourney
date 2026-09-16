import assert from "node:assert/strict";
import test from "node:test";
import { calculateJourneyMetrics } from "../app/journey.ts";

test("matches the $28,640 journey example", () => {
  const journey = calculateJourneyMetrics(28_640, [{ date: "2026-01-01", value: 10_000 }], "2026-01-11");
  assert.equal(Number((journey.totalReturn * 100).toFixed(1)), 186.4);
  assert.equal(Number((journey.progress * 100).toFixed(2)), 1.88);
  assert.equal(journey.daysSinceJourneyBegan, 10);
  assert.equal(journey.milestones.find((item) => item.value === 20_000)?.status, "achieved");
  assert.equal(journey.milestones.find((item) => item.value === 50_000)?.status, "next");
});

test("clamps progress below the $10K starting line and preserves the next milestone", () => {
  const journey = calculateJourneyMetrics(2_500, [{ date: "2026-01-01", value: 2_500 }], "2026-01-02");
  assert.equal(journey.progress, 0);
  assert.equal(journey.remainingToStart, 7_500);
  assert.equal(journey.milestones[0].status, "next");
});

test("maps the bull marker from the $10K start to the $1M target", () => {
  assert.equal(calculateJourneyMetrics(10_000, [], "2026-01-01").progress, 0);
  assert.equal(calculateJourneyMetrics(505_000, [], "2026-01-01").progress, 0.5);
  assert.equal(calculateJourneyMetrics(1_000_000, [], "2026-01-01").progress, 1);
  assert.equal(calculateJourneyMetrics(2_000_000, [], "2026-01-01").progress, 1);
});

test("uses the first recorded NAV crossing for milestone dates", () => {
  const journey = calculateJourneyMetrics(55_000, [
    { date: "2026-01-03", value: 52_000 },
    { date: "2026-01-01", value: 11_000 },
    { date: "2026-01-02", value: 49_000 },
  ], "2026-01-04");
  assert.equal(journey.milestones.find((item) => item.value === 10_000)?.reachedAt, "2026-01-01");
  assert.equal(journey.milestones.find((item) => item.value === 50_000)?.reachedAt, "2026-01-03");
  assert.equal(journey.milestones.find((item) => item.value === 100_000)?.status, "next");
});
