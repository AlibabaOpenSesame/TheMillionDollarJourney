import assert from "node:assert/strict";
import test from "node:test";
import { calculateJourneyMetrics } from "../app/journey.ts";

test("return and progress from the $1K start toward $1M", () => {
  const journey = calculateJourneyMetrics(3_333.84, [{ date: "2026-01-01", value: 1_000 }], "2026-09-16");
  assert.equal(Number((journey.totalReturn * 100).toFixed(1)), 233.4);
  assert.ok(journey.progress > 0 && journey.progress < 0.01);
  assert.equal(journey.remainingToStart, 0);
  assert.equal(journey.nextMilestoneValue, 5_000);
  assert.equal(journey.milestones.find((item) => item.value === 2_000)?.status, "achieved");
  assert.equal(journey.milestones.find((item) => item.value === 5_000)?.status, "next");
});

test("clamps progress below the $1K starting line and preserves the next milestone", () => {
  const journey = calculateJourneyMetrics(500, [{ date: "2026-01-01", value: 500 }], "2026-01-02");
  assert.equal(journey.progress, 0);
  assert.equal(journey.remainingToStart, 500);
  assert.equal(journey.milestones[0].status, "next");
  assert.equal(journey.nextMilestoneValue, 2_000);
});

test("maps the bull marker from the $1K start to the $1M target", () => {
  assert.equal(calculateJourneyMetrics(1_000, [], "2026-01-01").progress, 0);
  assert.equal(calculateJourneyMetrics(500_500, [], "2026-01-01").progress, 0.5);
  assert.equal(calculateJourneyMetrics(1_000_000, [], "2026-01-01").progress, 1);
  assert.equal(calculateJourneyMetrics(2_000_000, [], "2026-01-01").progress, 1);
});

test("uses the first recorded NAV crossing for milestone dates", () => {
  const journey = calculateJourneyMetrics(12_000, [
    { date: "2026-01-03", value: 12_000 },
    { date: "2026-01-01", value: 2_500 },
    { date: "2026-01-02", value: 6_000 },
  ], "2026-01-04");
  assert.equal(journey.milestones.find((item) => item.value === 2_000)?.reachedAt, "2026-01-01");
  assert.equal(journey.milestones.find((item) => item.value === 5_000)?.reachedAt, "2026-01-02");
  assert.equal(journey.milestones.find((item) => item.value === 10_000)?.reachedAt, "2026-01-03");
  assert.equal(journey.milestones.find((item) => item.value === 25_000)?.status, "next");
});
