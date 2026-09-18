import { marketSession } from "./market.ts";
import type { Session } from "./types";

export function evolveSession(previous: Session | null, date: string, value: number, snapshotDate: string, at: string, events: number): Session {
  if (previous && (previous.status !== "RUNNING" || Date.parse(at) <= Date.parse(previous.updatedAt))) return previous;
  return previous ? { ...previous, current: value, high: Math.max(previous.high, value), low: Math.min(previous.low, value), updatedAt: at, events: previous.events + events } :
    { date, openingNav: value, current: value, high: value, low: value, startedAt: at, updatedAt: at, sealedAt: null, events, status: "RUNNING", snapshotDate, coverage: 1 };
}
export function sealSession(session: Session, now: Date): Session {
  const schedule = marketSession(new Date(`${session.date}T17:00:00Z`));
  if (session.status !== "RUNNING" || !schedule.closesAt || now.getTime() < Date.parse(schedule.closesAt)) return session;
  // updatedAt is the oldest contributing quote time, never the fetch receipt time.
  const lastQuote = Date.parse(session.updatedAt);
  const close = Date.parse(schedule.closesAt);
  const complete = Number.isFinite(lastQuote) && lastQuote >= close - 600_000 && lastQuote <= close;
  return { ...session, status: complete ? "SEALED" : "INCOMPLETE", sealedAt: now.toISOString() };
}
