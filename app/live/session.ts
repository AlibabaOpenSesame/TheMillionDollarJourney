import { marketSession } from "./market.ts";
import type { Session } from "./types";

export function evolveSession(previous: Session | null, date: string, value: number, snapshotDate: string, at: string, events: number): Session {
  if (previous?.status === "SEALED") return previous;
  return previous ? { ...previous, current: value, high: Math.max(previous.high, value), low: Math.min(previous.low, value), updatedAt: at, events: previous.events + events } :
    { date, openingNav: value, current: value, high: value, low: value, startedAt: at, updatedAt: at, sealedAt: null, events, status: "RUNNING", snapshotDate, coverage: 1 };
}
export function sealSession(session: Session, now: Date): Session {
  const schedule = marketSession(new Date(`${session.date}T17:00:00Z`));
  if (session.status !== "RUNNING" || !schedule.closesAt || now.getTime() < Date.parse(schedule.closesAt)) return session;
  const complete = Date.parse(session.updatedAt) >= Date.parse(schedule.closesAt) - 600_000;
  return { ...session, status: complete ? "SEALED" : "INCOMPLETE", sealedAt: now.toISOString() };
}
