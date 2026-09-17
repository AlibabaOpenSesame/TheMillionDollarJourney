/** KV latest-cache only — never store Flex XML / tokens / account PII. */
export type LatestPortfolio = {
  tradeDate: string;
  updatedAt: string;
  nav: number;
  cash: number;
  marketValue: number;
  unrealizedPnl: number;
  currency: string;
};

export type LatestPosition = {
  symbol: string;
  quantity: number;
  price: number;
  marketValue: number;
  averagePrice: number;
  unrealizedPnl: number;
};

export type SyncStatusCache = {
  status: string;
  updatedAt: string;
  asOf: string | null;
  trigger: string;
  error?: string;
};

const PORTFOLIO_KEY = "portfolio:latest";
const POSITIONS_KEY = "positions:latest";
const SYNC_KEY = "sync:status";

export async function writeLatestCache(
  cache: KVNamespace,
  portfolio: LatestPortfolio,
  positions: LatestPosition[],
  sync: SyncStatusCache,
) {
  await Promise.all([
    cache.put(PORTFOLIO_KEY, JSON.stringify(portfolio)),
    cache.put(POSITIONS_KEY, JSON.stringify(positions)),
    cache.put(SYNC_KEY, JSON.stringify(sync)),
  ]);
}

export async function writeSyncStatus(cache: KVNamespace, sync: SyncStatusCache) {
  await cache.put(SYNC_KEY, JSON.stringify(sync));
}

export async function readLatestPortfolio(cache: KVNamespace) {
  const raw = await cache.get(PORTFOLIO_KEY);
  return raw ? (JSON.parse(raw) as LatestPortfolio) : null;
}
