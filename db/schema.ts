import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  asOf: text("as_of").primaryKey(),
  syncedAt: text("synced_at").notNull(),
  currency: text("currency").notNull().default("USD"),
  netLiquidation: real("net_liquidation").notNull(),
  previousNav: real("previous_nav").notNull().default(0),
  totalCash: real("total_cash").notNull().default(0),
  availableFunds: real("available_funds").notNull().default(0),
  buyingPower: real("buying_power").notNull().default(0),
  grossPositionValue: real("gross_position_value").notNull().default(0),
  dailyPnl: real("daily_pnl").notNull().default(0),
  dailyReturn: real("daily_return").notNull().default(0),
  weekReturn: real("week_return").notNull().default(0),
  ytdReturn: real("ytd_return").notNull().default(0),
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
  leverage: real("leverage").notNull().default(0),
  realizedYtd: real("realized_ytd").notNull().default(0),
  source: text("source").notNull().default("IBKR Flex Web Service"),
});

export const portfolioPositions = sqliteTable("portfolio_positions", {
  asOf: text("as_of").notNull().references(() => portfolioSnapshots.asOf, { onDelete: "cascade" }),
  contractKey: text("contract_key").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull().default(""),
  assetClass: text("asset_class").notNull().default("STK"),
  currency: text("currency").notNull().default("USD"),
  quantity: real("quantity").notNull().default(0),
  price: real("price").notNull().default(0),
  averagePrice: real("average_price").notNull().default(0),
  marketValue: real("market_value").notNull().default(0),
  dailyPnl: real("daily_pnl").notNull().default(0),
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.asOf, table.contractKey] }),
  index("portfolio_positions_as_of_idx").on(table.asOf),
]);

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status").notNull(),
  asOf: text("as_of"),
  error: text("error"),
});

export const fxRates = sqliteTable("fx_rates", {
  pair: text("pair").primaryKey(),
  rate: real("rate").notNull(),
  quotedAt: text("quoted_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  source: text("source").notNull(),
});

export const trades = sqliteTable("trades", {
  tradeId: text("trade_id").primaryKey(),
  tradeDate: text("trade_date").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side"),
  quantity: real("quantity"),
  price: real("price"),
  commission: real("commission"),
  currency: text("currency").default("USD"),
  tradeTime: text("trade_time"),
}, (table) => [
  index("idx_trades_date").on(table.tradeDate),
]);

