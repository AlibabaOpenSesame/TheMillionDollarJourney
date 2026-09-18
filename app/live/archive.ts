import snapshots from "../../data/v2-baseline/portfolio_snapshots.json";
import positions from "../../data/v2-baseline/portfolio_positions.json";
import type { PortfolioData } from "../portfolio-data";

export function archivePortfolio(): PortfolioData {
  const rows = [...snapshots].sort((a, b) => a.as_of.localeCompare(b.as_of));
  const row = rows.at(-1)!;
  return {
    asOf: row.as_of, updatedAt: row.synced_at, currency: row.currency,
    netLiquidation: row.net_liquidation, previousNav: row.previous_nav, totalCash: row.total_cash,
    availableFunds: row.available_funds, buyingPower: row.buying_power, grossPositionValue: row.gross_position_value,
    dailyPnl: row.daily_pnl, dailyReturn: row.daily_return, weekReturn: row.week_return, ytdReturn: row.ytd_return,
    unrealizedPnl: row.unrealized_pnl, leverage: row.leverage, realizedYtd: row.realized_ytd, source: row.source,
    navHistory: rows.map(r => ({ date: r.as_of, value: r.net_liquidation })),
    positions: positions.filter(p => p.as_of === row.as_of).map(p => ({ contractKey: p.contract_key, symbol: p.symbol,
      name: p.name, assetClass: p.asset_class, currency: p.currency, quantity: p.quantity, price: p.price,
      averagePrice: p.average_price, marketValue: p.market_value, dailyPnl: p.daily_pnl, unrealizedPnl: p.unrealized_pnl })),
  };
}
