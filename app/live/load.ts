import { loadPortfolio } from "../load-portfolio";
import { archivePortfolio } from "./archive";
import { marketSession } from "./market";
import { estimatePortfolio } from "./valuation";
import type { LiveDashboard } from "./types";
import { readLiveDashboard, type LiveEnv } from "../../worker/live-service";

export async function loadLiveDashboard(): Promise<LiveDashboard> {
  try {
    const { env } = await import("cloudflare:workers");
    if ((env as LiveEnv).DB) return await readLiveDashboard(env as LiveEnv);
  } catch {
    // Retain a visibly labelled archive, never invent live observations.
  }
  const data = await loadPortfolio("USD");
  const portfolio = data.usingFallback ? archivePortfolio() : data.portfolio;
  const now = new Date();
  const market = marketSession(now);
  return { portfolio, snapshotOrigin: data.usingFallback ? "archive" : "database", quotes: [],
    estimate: estimatePortfolio(portfolio, [], market, now), market, activity: [], intraday: [], sessions: [], trades: [],
    sync: { configured: data.configured, status: data.lastRun?.status ?? "unconfigured", startedAt: data.lastRun?.startedAt ?? null, completedAt: data.lastRun?.completedAt ?? null },
    feed: { configured: false, status: "unconfigured", checkedAt: null, intervalSeconds: 60 }, servedAt: now.toISOString() };
}
