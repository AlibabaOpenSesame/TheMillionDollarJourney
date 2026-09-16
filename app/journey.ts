export const JOURNEY_START_VALUE = 10_000;
export const JOURNEY_TARGET_VALUE = 1_000_000;
export const JOURNEY_MILESTONE_VALUES = [10_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export type JourneyNavPoint = { date: string; value: number };
export type JourneyMilestoneStatus = "achieved" | "next" | "locked";

export type JourneyMilestone = {
  value: number;
  status: JourneyMilestoneStatus;
  reachedAt: string | null;
  daysFromJourneyStart: number | null;
};

export type JourneyMetrics = {
  currentValue: number;
  totalReturn: number;
  progress: number;
  remainingToStart: number;
  remainingToTarget: number;
  journeyBeganAt: string | null;
  daysSinceJourneyBegan: number | null;
  milestones: JourneyMilestone[];
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function calculateJourneyMetrics(currentValue: number, history: JourneyNavPoint[], asOf: string): JourneyMetrics {
  const safeCurrent = Number.isFinite(currentValue) ? Math.max(0, currentValue) : 0;
  const points = history
    .filter((point) => validDate(point.date) && Number.isFinite(point.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const journeyBeganAt = points[0]?.date ?? null;
  const asOfDate = validDate(asOf) ? asOf : points.at(-1)?.date ?? null;
  const daysSinceJourneyBegan = journeyBeganAt && asOfDate
    ? Math.max(0, Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${journeyBeganAt}T00:00:00Z`)) / 86_400_000))
    : null;
  const totalReturn = safeCurrent / JOURNEY_START_VALUE - 1;
  const rawProgress = (safeCurrent - JOURNEY_START_VALUE) / (JOURNEY_TARGET_VALUE - JOURNEY_START_VALUE);
  const progress = Math.min(1, Math.max(0, rawProgress));
  const nextValue = JOURNEY_MILESTONE_VALUES.find((value) => safeCurrent < value) ?? null;

  return {
    currentValue: safeCurrent,
    totalReturn,
    progress,
    remainingToStart: Math.max(0, JOURNEY_START_VALUE - safeCurrent),
    remainingToTarget: Math.max(0, JOURNEY_TARGET_VALUE - safeCurrent),
    journeyBeganAt,
    daysSinceJourneyBegan,
    milestones: JOURNEY_MILESTONE_VALUES.map((value) => {
      const reachedAt = points.find((point) => point.value >= value)?.date ?? null;
      const daysFromJourneyStart = journeyBeganAt && reachedAt
        ? Math.max(0, Math.floor((Date.parse(`${reachedAt}T00:00:00Z`) - Date.parse(`${journeyBeganAt}T00:00:00Z`)) / 86_400_000))
        : null;
      return {
        value,
        status: safeCurrent >= value ? "achieved" : value === nextValue ? "next" : "locked",
        reachedAt,
        daysFromJourneyStart,
      };
    }),
  };
}
