import {
  PortfolioApiResponse,
  PortfolioData,
  PortfolioPosition,
  verifiedFallbackPortfolio,
} from "./portfolio-data";

export type LoadedPortfolio = {
  portfolio: PortfolioData;
  configured: boolean;
  lastRun: PortfolioApiResponse["lastRun"];
  fx: PortfolioApiResponse["fx"];
  usingFallback: boolean;
  syncTriggered: boolean;
  latestScheduledAt: string | null;
};

type SnapshotRow = {
  asOf: string;
  syncedAt: string;
  currency: string;
  netLiquidation: number;
  previousNav: number;
  totalCash: number;
  availableFunds: number;
  buyingPower: number;
  grossPositionValue: number;
  dailyPnl: number;
  dailyReturn: number;
  weekReturn: number;
  ytdReturn: number;
  unrealizedPnl: number;
  leverage: number;
  realizedYtd: number;
  source: string;
};

type SyncRunRow = NonNullable<PortfolioApiResponse["lastRun"]>;

/**
 * SSR first paint: read D1 via cloudflare:workers bindings.
 * Do NOT HTTP self-fetch /api/portfolio — Workers cannot reliably call themselves mid-request.
 */
export async function loadPortfolio(_displayCurrency: "USD" | "CNY" = "USD"): Promise<LoadedPortfolio> {
  const emptyMeta = {
    configured: false,
    lastRun: null as PortfolioApiResponse["lastRun"],
    fx: null as PortfolioApiResponse["fx"],
    syncTriggered: false,
    latestScheduledAt: null as string | null,
  };

  try {
    const { env } = await import("cloudflare:workers");
    const db = (env as { DB?: D1Database; IBKR_FLEX_TOKEN?: string; IBKR_FLEX_QUERY_ID?: string }).DB;
    const token = (env as { IBKR_FLEX_TOKEN?: string }).IBKR_FLEX_TOKEN;
    const queryId = (env as { IBKR_FLEX_QUERY_ID?: string }).IBKR_FLEX_QUERY_ID;
    const configured = Boolean(token && queryId);

    if (!db) {
      return { portfolio: verifiedFallbackPortfolio, usingFallback: true, ...emptyMeta, configured };
    }

    const snapshot = await db.prepare(`SELECT
      as_of AS asOf, synced_at AS syncedAt, currency, net_liquidation AS netLiquidation,
      previous_nav AS previousNav, total_cash AS totalCash, available_funds AS availableFunds,
      buying_power AS buyingPower, gross_position_value AS grossPositionValue,
      daily_pnl AS dailyPnl, daily_return AS dailyReturn, week_return AS weekReturn,
      ytd_return AS ytdReturn, unrealized_pnl AS unrealizedPnl, leverage,
      realized_ytd AS realizedYtd, source
      FROM portfolio_snapshots ORDER BY as_of DESC LIMIT 1`).first<SnapshotRow>();

    const lastRun = await db.prepare(`SELECT status, started_at AS startedAt,
      completed_at AS completedAt, as_of AS asOf, error, trigger
      FROM sync_runs ORDER BY id DESC LIMIT 1`).first<SyncRunRow>();

    if (!snapshot) {
      return {
        portfolio: verifiedFallbackPortfolio,
        usingFallback: true,
        configured,
        lastRun,
        fx: null,
        syncTriggered: false,
        latestScheduledAt: null,
      };
    }

    const positions = await db.prepare(`SELECT
      contract_key AS contractKey, symbol, name, asset_class AS assetClass, currency,
      quantity, price, average_price AS averagePrice, market_value AS marketValue,
      daily_pnl AS dailyPnl, unrealized_pnl AS unrealizedPnl
      FROM portfolio_positions WHERE as_of = ? ORDER BY ABS(market_value) DESC`).bind(snapshot.asOf).all<PortfolioPosition>();

    const history = await db.prepare(`SELECT as_of AS date, net_liquidation AS value
      FROM portfolio_snapshots ORDER BY as_of DESC LIMIT 260`).all<{ date: string; value: number }>();

    const portfolio: PortfolioData = {
      ...snapshot,
      updatedAt: snapshot.syncedAt,
      positions: positions.results ?? [],
      navHistory: [...(history.results ?? [])].reverse(),
    };

    return {
      portfolio,
      usingFallback: false,
      configured,
      lastRun,
      fx: null,
      syncTriggered: false,
      latestScheduledAt: null,
    };
  } catch {
    return { portfolio: verifiedFallbackPortfolio, usingFallback: true, ...emptyMeta };
  }
}
