import type { PortfolioData } from "../portfolio-data";

export type DataState = "LIVE" | "ESTIMATED" | "IBKR VERIFIED" | "SYNCING" | "DELAYED" | "STALE" | "UNAVAILABLE";
export type Quote = {
  symbol: string; price: number; previousClose: number | null; currency: string;
  quotedAt: string; receivedAt: string; source: string; entitlement: "realtime" | "delayed" | "unknown";
};
export type MarketSession = {
  date: string; state: "OPEN" | "CLOSED" | "UNKNOWN"; opensAt: string | null; closesAt: string | null;
  source: string;
};
export type Estimate = {
  value: number | null; change: number | null; changePercent: number | null;
  coverage: number; state: DataState; quotedAt: string | null; missingSymbols: string[];
};
export type Activity = {
  id: string; occurredAt: string; kind: "quote" | "valuation" | "verified" | "session" | "system";
  symbol: string | null; value: number | null; previousValue: number | null; source: string; detail: string;
};
export type Session = {
  date: string; openingNav: number; current: number; high: number; low: number;
  events: number; status: "RUNNING" | "SEALED" | "INCOMPLETE"; startedAt: string; updatedAt: string;
  sealedAt: string | null; snapshotDate: string; coverage: number;
};
export type Trade = { tradeId: string; tradeDate: string; symbol: string; side: string; quantity: number; price: number; commission: number; currency: string };
export type LiveDashboard = {
  portfolio: PortfolioData | null; snapshotOrigin: "database" | "archive" | "unavailable";
  quotes: Quote[]; estimate: Estimate; market: MarketSession; activity: Activity[];
  intraday: Array<{ time: string; value: number }>; sessions: Session[]; trades: Trade[];
  sync: { configured: boolean; status: string; startedAt: string | null; completedAt: string | null };
  feed: { configured: boolean; status: string; checkedAt: string | null; intervalSeconds: number };
  servedAt: string;
};
