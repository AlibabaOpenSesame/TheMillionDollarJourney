import { archivePortfolio } from "../app/live/archive";
import { marketSession } from "../app/live/market";
import { estimatePortfolio } from "../app/live/valuation";
import { evolveSession, sealSession } from "../app/live/session";
import type { Activity, LiveDashboard, Quote, Session, Trade } from "../app/live/types";
import { readPortfolio, type Env } from "./index";
import { fetchQuotes } from "./quotes";

export interface LiveEnv extends Env { QUOTE_ENTITLEMENT?: string; QUOTE_INTERVAL_SECONDS?: string }
const quoteSelect = `SELECT symbol, price, previous_close AS previousClose, currency, quoted_at AS quotedAt, received_at AS receivedAt, source, entitlement FROM live_quotes`;
const sessionSelect = `SELECT date, opening_nav AS openingNav, current, high, low, events, status, started_at AS startedAt, updated_at AS updatedAt, sealed_at AS sealedAt, snapshot_date AS snapshotDate, coverage FROM portfolio_sessions`;
export function quoteInterval(env: LiveEnv) { return Math.max(60, Math.min(900, Number(env.QUOTE_INTERVAL_SECONDS) || 300)); }

export async function readLiveDashboard(env: LiveEnv, now = new Date()): Promise<LiveDashboard> {
  const market = marketSession(now), base = await readPortfolio(env);
  const portfolio = base.portfolio ?? archivePortfolio();
  const [q, a, i, s, tr, feed] = await Promise.all([
    env.DB.prepare(quoteSelect).all<Quote>(),
    env.DB.prepare(`SELECT id, occurred_at AS occurredAt, kind, symbol, value, previous_value AS previousValue, source, detail FROM live_activity ORDER BY occurred_at DESC, id DESC LIMIT 40`).all<Activity>(),
    env.DB.prepare("SELECT time, value FROM valuation_samples WHERE session_date = ? ORDER BY time ASC LIMIT 1000").bind(market.date).all<{ time: string; value: number }>(),
    env.DB.prepare(`${sessionSelect} ORDER BY date DESC LIMIT 30`).all<Session>(),
    env.DB.prepare("SELECT trade_id AS tradeId, trade_date AS tradeDate, symbol, side, quantity, price, commission, currency FROM trades ORDER BY trade_date DESC LIMIT 100").all<Trade>(),
    env.DB.prepare("SELECT value, updated_at AS updatedAt FROM runtime_state WHERE key = 'quote-feed'").first<{ value: string; updatedAt: string }>(),
  ]);
  return { portfolio, snapshotOrigin: base.portfolio ? "database" : "archive", quotes: q.results,
    estimate: estimatePortfolio(portfolio, q.results, market, now), market, activity: a.results,
    intraday: i.results, sessions: s.results, trades: tr.results,
    sync: { configured: Boolean(env.IBKR_FLEX_TOKEN && env.IBKR_FLEX_QUERY_ID), status: base.lastRun?.status ?? "unconfigured", startedAt: base.lastRun?.startedAt ?? null, completedAt: base.lastRun?.completedAt ?? null },
    feed: { configured: Boolean(env.TWELVE_DATA_API_KEY), status: feed?.value ?? "unconfigured", checkedAt: feed?.updatedAt ?? null, intervalSeconds: quoteInterval(env) }, servedAt: now.toISOString() };
}

export async function withLock<T>(db: D1Database, key: string, work: () => Promise<T>, ttlSeconds = 180): Promise<T | null> {
  const owner = crypto.randomUUID(), now = Date.now();
  const acquired = await db.prepare(`INSERT INTO sync_locks (key, owner, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE sync_locks.expires_at < ?`)
    .bind(key, owner, now + ttlSeconds * 1000, now).run();
  if (!acquired.meta.changes) return null;
  try { return await work(); } finally { await db.prepare("DELETE FROM sync_locks WHERE key=? AND owner=?").bind(key, owner).run(); }
}
function activityInsert(db: D1Database, e: Activity) {
  return db.prepare("INSERT OR IGNORE INTO live_activity (id,occurred_at,kind,symbol,value,previous_value,source,detail) VALUES (?,?,?,?,?,?,?,?)")
    .bind(e.id, e.occurredAt, e.kind, e.symbol, e.value, e.previousValue, e.source, e.detail);
}
export async function recordVerified(env: LiveEnv, asOf: string, value: number, at: string) {
  await activityInsert(env.DB, { id: `verified:${asOf}`, occurredAt: at, kind: "verified", symbol: null, value, previousValue: null, source: "IBKR Flex", detail: `IBKR snapshot verified · ${asOf}` }).run();
}

export async function refreshMarket(env: LiveEnv, now = new Date()) {
  return withLock(env.DB, "market-refresh", async () => {
    const running = await env.DB.prepare(`${sessionSelect} WHERE status='RUNNING'`).all<Session>();
    for (const session of running.results) {
      const sealed = sealSession(session, now);
      if (sealed.status !== session.status) await env.DB.batch([
        env.DB.prepare("UPDATE portfolio_sessions SET status=?, sealed_at=? WHERE date=? AND status='RUNNING'").bind(sealed.status, sealed.sealedAt, sealed.date),
        activityInsert(env.DB, { id: `session:${sealed.date}:${sealed.status}`, occurredAt: now.toISOString(), kind: "session", symbol: null, value: sealed.current, previousValue: null, source: "Observed market estimates", detail: `Session ${sealed.status.toLowerCase()} · ${sealed.date}` }),
      ]);
    }
    const market = marketSession(now);
    if (market.state !== "OPEN") return { status: "market-closed" };
    const last = await env.DB.prepare("SELECT updated_at AS updatedAt FROM runtime_state WHERE key='quote-feed'").first<{ updatedAt: string }>();
    if (last && now.getTime() - Date.parse(last.updatedAt) < quoteInterval(env) * 1000) return { status: "cached" };
    const setStatus = (status: string) => env.DB.prepare("INSERT INTO runtime_state (key,value,updated_at) VALUES ('quote-feed',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(status, now.toISOString()).run();
    if (!env.TWELVE_DATA_API_KEY) { await setStatus("unconfigured"); return { status: "unconfigured" }; }
    const data = await readPortfolio(env);
    if (!data.portfolio) { await setStatus("awaiting-verified-holdings"); return { status: "awaiting-verified-holdings" }; }
    const portfolio = data.portfolio;
    const entitlement = env.QUOTE_ENTITLEMENT === "realtime" ? "realtime" : env.QUOTE_ENTITLEMENT === "delayed" ? "delayed" : "unknown";
    const symbols = portfolio.positions.filter(p => p.currency === "USD" && ["STK", "ETF"].includes(p.assetClass)).map(p => p.symbol);
    const previous = await env.DB.prepare(quoteSelect).all<Quote>();
    const fetched = await fetchQuotes(symbols, env.TWELVE_DATA_API_KEY!, entitlement, fetch, now);
    const statements: D1PreparedStatement[] = [], events: Activity[] = [];
    const accepted = fetched.quotes.filter(q => !previous.results.some(old => old.symbol === q.symbol && old.quotedAt > q.quotedAt));
    for (const q of accepted) {
      const old = previous.results.find(p => p.symbol === q.symbol);
      statements.push(env.DB.prepare(`INSERT INTO live_quotes (symbol,price,previous_close,currency,quoted_at,received_at,source,entitlement) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price,previous_close=excluded.previous_close,currency=excluded.currency,quoted_at=excluded.quoted_at,received_at=excluded.received_at,source=excluded.source,entitlement=excluded.entitlement WHERE excluded.quoted_at >= live_quotes.quoted_at`).bind(q.symbol,q.price,q.previousClose,q.currency,q.quotedAt,q.receivedAt,q.source,q.entitlement));
      if (!old || old.price !== q.price) events.push({ id: `quote:${q.symbol}:${q.quotedAt}`, occurredAt: q.receivedAt, kind: "quote", symbol: q.symbol, value: q.price, previousValue: old?.price ?? null, source: q.source, detail: "Observed market quote" });
    }
    const estimate = estimatePortfolio(portfolio, accepted, market, now);
    if (estimate.value !== null && estimate.state !== "STALE" && estimate.quotedAt) {
      const sampleId = `${market.date}:${estimate.quotedAt}:${portfolio.asOf}`;
      const exists = await env.DB.prepare("SELECT id FROM valuation_samples WHERE id=?").bind(sampleId).first();
      if (!exists) {
        const previousSession = await env.DB.prepare(`${sessionSelect} WHERE date=?`).bind(market.date).first<Session>();
        const session = evolveSession(previousSession, market.date, estimate.value, portfolio.asOf, estimate.quotedAt, events.length + 1);
        events.push({ id: `valuation:${sampleId}`, occurredAt: now.toISOString(), kind: "valuation", symbol: null, value: estimate.value, previousValue: previousSession?.current ?? null, source: "IBKR holdings + Twelve Data", detail: `Estimated portfolio value · ${estimate.state.toLowerCase()}` });
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO valuation_samples (id,session_date,time,value,snapshot_date,state) VALUES (?,?,?,?,?,?)").bind(sampleId,market.date,estimate.quotedAt,estimate.value,portfolio.asOf,estimate.state));
        statements.push(env.DB.prepare(`INSERT INTO portfolio_sessions (date,opening_nav,current,high,low,events,status,started_at,updated_at,sealed_at,snapshot_date,coverage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET current=excluded.current,high=excluded.high,low=excluded.low,events=excluded.events,updated_at=excluded.updated_at WHERE portfolio_sessions.status='RUNNING'`).bind(session.date,session.openingNav,session.current,session.high,session.low,session.events,session.status,session.startedAt,session.updatedAt,session.sealedAt,session.snapshotDate,session.coverage));
      }
    }
    statements.push(...events.map(e => activityInsert(env.DB, e)));
    if (statements.length) await env.DB.batch(statements);
    await setStatus(fetched.failed.length ? "partial-or-unavailable" : "connected");
    return { status: fetched.failed.length ? "partial" : "success", observed: accepted.length };
  });
}
