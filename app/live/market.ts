import type { MarketSession } from "./types";

// NYSE published calendar: https://www.nyse.com/markets/hours-calendars
// Fail closed outside reviewed calendar years; scheduled hours do not detect unscheduled exchange halts.
const holidays = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const early = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
export function marketSession(now = new Date()): MarketSession {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now);
  const p = (type: string) => parts.find(x => x.type === type)?.value ?? "";
  const date = `${p("year")}-${p("month")}-${p("day")}`;
  const source = "NYSE published regular-session calendar · America/New_York";
  if (!["2026", "2027"].includes(p("year"))) return { date, state: "UNKNOWN", opensAt: null, closesAt: null, source };
  if (["Sat", "Sun"].includes(p("weekday")) || holidays.has(date)) return { date, state: "CLOSED", opensAt: null, closesAt: null, source };
  // Determine current date's NY offset from a noon probe, safely away from DST transitions.
  const probe = new Date(`${date}T16:00:00Z`);
  const nyHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(probe));
  const offset = 16 - nyHour;
  const closeHour = early.has(date) ? 13 : 16;
  const opensAt = `${date}T${String(9 + offset).padStart(2, "0")}:30:00.000Z`;
  const closesAt = `${date}T${String(closeHour + offset).padStart(2, "0")}:00:00.000Z`;
  return { date, state: now.getTime() >= Date.parse(opensAt) && now.getTime() < Date.parse(closesAt) ? "OPEN" : "CLOSED", opensAt, closesAt, source };
}
