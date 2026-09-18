import type { PortfolioData } from "../portfolio-data";
import type { DataState, Estimate, MarketSession, Quote } from "./types";

export function quoteState(quote: Quote | undefined, now: Date, market: MarketSession): DataState {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return "UNAVAILABLE";
  const age = now.getTime() - Date.parse(quote.quotedAt);
  if (!Number.isFinite(age) || age < -60_000) return "UNAVAILABLE";
  if (market.state !== "OPEN") return age > 4 * 86_400_000 ? "STALE" : "ESTIMATED";
  if (age > 20 * 60_000) return "STALE";
  if (age > 90_000 || quote.entitlement !== "realtime") return "DELAYED";
  return "LIVE";
}

/** USD equity estimates only. Never silently price an unsupported contract or missing symbol at zero. */
export function estimatePortfolio(portfolio: PortfolioData | null, quotes: Quote[], market: MarketSession, now = new Date()): Estimate {
  const empty: Estimate = { value: null, change: null, changePercent: null, coverage: 0, state: "UNAVAILABLE", quotedAt: null, missingSymbols: [] };
  if (!portfolio || portfolio.currency !== "USD" || !Number.isFinite(portfolio.totalCash)) return empty;
  const bySymbol = new Map(quotes.map(q => [q.symbol, q]));
  const missing: string[] = [];
  const used: Quote[] = [];
  let value = portfolio.totalCash;
  let reference = portfolio.totalCash;
  let previousCloseComplete = true;
  for (const position of portfolio.positions) {
    if (!position.quantity) continue;
    const q = bySymbol.get(position.symbol);
    const valid = position.currency === "USD" && ["STK", "ETF"].includes(position.assetClass) && q?.currency === "USD" && quoteState(q, now, market) !== "UNAVAILABLE";
    if (!valid || !q) { missing.push(position.symbol); continue; }
    used.push(q);
    value += position.quantity * q.price;
    if (q.previousClose !== null && Number.isFinite(q.previousClose) && q.previousClose > 0) reference += position.quantity * q.previousClose;
    else previousCloseComplete = false;
  }
  const active = portfolio.positions.filter(p => p.quantity !== 0).length;
  const coverage = active ? used.length / active : 1;
  if (missing.length) return { ...empty, coverage, missingSymbols: missing };
  const states = used.map(q => quoteState(q, now, market));
  const timestamps = used.map(q => q.quotedAt).sort();
  const state = states.includes("STALE") ? "STALE" : states.includes("DELAYED") ? "DELAYED" : "ESTIMATED";
  return { value, change: previousCloseComplete ? value - reference : null,
    changePercent: previousCloseComplete && reference > 0 ? value / reference - 1 : null,
    coverage, state, quotedAt: timestamps[0] ?? null, missingSymbols: [] };
}

export function snapshotState(asOf: string, now = new Date()): DataState {
  const age = now.getTime() - Date.parse(`${asOf}T21:00:00Z`);
  return !Number.isFinite(age) || age > 4 * 86_400_000 ? "STALE" : "IBKR VERIFIED";
}
