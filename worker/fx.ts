import type { FxQuote } from "../app/portfolio-data";

const FX_PAIR = "USD/CNY" as const;
const FX_SOURCE = "Twelve Data" as const;
const FX_CACHE_MS = 5 * 60 * 1000;
const FX_QUOTE_STALE_MS = 15 * 60 * 1000;

type FxEnv = {
  DB: D1Database;
  TWELVE_DATA_API_KEY?: string;
};

export type StoredFxRate = {
  pair: typeof FX_PAIR;
  rate: number;
  quotedAt: string;
  fetchedAt: string;
  source: typeof FX_SOURCE;
};

type FxResolution = {
  quote: FxQuote;
  recordToStore: StoredFxRate | null;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function quoteFromRecord(record: StoredFxRate, status: "live" | "stale"): FxQuote {
  return { ...record, status };
}

function quoteStatus(record: StoredFxRate, now: Date): "live" | "stale" {
  const quotedAt = Date.parse(record.quotedAt);
  return Number.isFinite(quotedAt) && Math.abs(now.getTime() - quotedAt) <= FX_QUOTE_STALE_MS ? "live" : "stale";
}

export function unavailableUsdCnyQuote(): FxQuote {
  return {
    pair: FX_PAIR,
    rate: null,
    quotedAt: null,
    fetchedAt: null,
    source: FX_SOURCE,
    status: "unavailable",
  };
}

export function parseTwelveDataRate(payload: unknown, fetchedAt: string): StoredFxRate {
  if (!payload || typeof payload !== "object") throw new Error("Invalid FX response");
  const data = payload as { rate?: unknown; timestamp?: unknown };
  const rate = typeof data.rate === "number" ? data.rate : Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) throw new Error("Invalid USD/CNY rate");

  const timestamp = typeof data.timestamp === "number" ? data.timestamp : Number(data.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 946_684_800) throw new Error("Invalid FX timestamp");
  const timestampDate = new Date(timestamp * 1000);
  if (Number.isNaN(timestampDate.getTime())) throw new Error("Invalid FX timestamp");

  return {
    pair: FX_PAIR,
    rate,
    quotedAt: timestampDate.toISOString(),
    fetchedAt,
    source: FX_SOURCE,
  };
}

export async function resolveUsdCnyRate(
  cached: StoredFxRate | null,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<FxResolution> {
  const cachedAt = cached ? Date.parse(cached.fetchedAt) : Number.NaN;
  if (cached && Number.isFinite(cachedAt) && now.getTime() - cachedAt < FX_CACHE_MS) {
    return { quote: quoteFromRecord(cached, quoteStatus(cached, now)), recordToStore: null };
  }

  if (!apiKey) {
    return {
      quote: cached ? quoteFromRecord(cached, "stale") : unavailableUsdCnyQuote(),
      recordToStore: null,
    };
  }

  try {
    const url = new URL("https://api.twelvedata.com/exchange_rate");
    url.searchParams.set("symbol", FX_PAIR);
    const response = await fetcher(url, {
      headers: { authorization: `apikey ${apiKey}`, "user-agent": "IBKR-Portfolio-Panorama/1.0" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`FX provider returned HTTP ${response.status}`);
    const record = parseTwelveDataRate(await response.json(), now.toISOString());
    return { quote: quoteFromRecord(record, quoteStatus(record, now)), recordToStore: record };
  } catch {
    return {
      quote: cached ? quoteFromRecord(cached, "stale") : unavailableUsdCnyQuote(),
      recordToStore: null,
    };
  }
}

export async function getUsdCnyRate(env: FxEnv): Promise<FxQuote> {
  const cached = await env.DB.prepare(`SELECT pair, rate, quoted_at AS quotedAt,
    fetched_at AS fetchedAt, source FROM fx_rates WHERE pair = ? LIMIT 1`)
    .bind(FX_PAIR)
    .first<StoredFxRate>();
  const resolved = await resolveUsdCnyRate(cached, env.TWELVE_DATA_API_KEY);

  if (resolved.recordToStore) {
    const record = resolved.recordToStore;
    await env.DB.prepare(`INSERT INTO fx_rates (pair, rate, quoted_at, fetched_at, source)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pair) DO UPDATE SET rate=excluded.rate, quoted_at=excluded.quoted_at,
      fetched_at=excluded.fetched_at, source=excluded.source`)
      .bind(record.pair, record.rate, record.quotedAt, record.fetchedAt, record.source)
      .run();
  }

  return resolved.quote;
}
