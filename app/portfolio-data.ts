export type PortfolioPosition = {
  contractKey: string;
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  quantity: number;
  price: number;
  averagePrice: number;
  marketValue: number;
  dailyPnl: number;
  unrealizedPnl: number;
};

export type PortfolioData = {
  asOf: string;
  updatedAt: string;
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
  navHistory: Array<{ date: string; value: number }>;
  positions: PortfolioPosition[];
};

export type FxQuote = {
  pair: "USD/CNY";
  rate: number | null;
  quotedAt: string | null;
  fetchedAt: string | null;
  source: "Twelve Data";
  status: "live" | "stale" | "unavailable";
};

export type PortfolioApiResponse = {
  configured: boolean;
  syncTriggered: boolean;
  latestScheduledAt: string;
  portfolio: PortfolioData | null;
  lastRun: {
    status: string;
    startedAt: string;
    completedAt: string | null;
    asOf: string | null;
    error: string | null;
    trigger: "manual" | "scheduled" | "recovery" | "import";
  } | null;
  fx: FxQuote | null;
};

// Verified through the connected IBKR account on 2026-07-19. It remains visible
// only until the first successful Flex Web Service snapshot is stored in D1.
export const verifiedFallbackPortfolio: PortfolioData = {
  asOf: "2026-07-17",
  updatedAt: "2026-07-19 06:43 IBKR",
  currency: "USD",
  netLiquidation: 2671.91,
  previousNav: 2676.28,
  totalCash: 0.92,
  availableFunds: 0.92,
  buyingPower: 0.92,
  grossPositionValue: 2670.99,
  dailyPnl: -86.54,
  dailyReturn: -0.00163234,
  weekReturn: -0.10141051,
  ytdReturn: 0.03443278,
  unrealizedPnl: -454.12,
  leverage: 1,
  realizedYtd: 469.579896,
  source: "IBKR 已连接账户验证快照",
  navHistory: [
    { date: "2026-06-19", value: 2666.76 },
    { date: "2026-06-22", value: 2493.75 },
    { date: "2026-06-26", value: 2832.04 },
    { date: "2026-07-01", value: 3108.26 },
    { date: "2026-07-07", value: 3077.67 },
    { date: "2026-07-10", value: 2973.45 },
    { date: "2026-07-13", value: 2886.67 },
    { date: "2026-07-14", value: 2979.24 },
    { date: "2026-07-15", value: 2920.20 },
    { date: "2026-07-16", value: 2759.79 },
    { date: "2026-07-17", value: 2671.91 },
  ],
  positions: [
    {
      contractKey: "709237125",
      symbol: "TEM",
      name: "Tempus AI",
      assetClass: "STK",
      currency: "USD",
      quantity: 43,
      price: 52.4700012,
      averagePrice: 63.69626047,
      marketValue: 2256.2100516,
      dailyPnl: -48.1599484,
      unrealizedPnl: -482.7291484,
    },
    {
      contractKey: "472693173",
      symbol: "LFMD",
      name: "LifeMD",
      assetClass: "STK",
      currency: "USD",
      quantity: 101,
      price: 4.1199999,
      averagePrice: 3.82341683,
      marketValue: 416.1199899,
      dailyPnl: -38.3800101,
      unrealizedPnl: 29.9548899,
    },
  ],
};
