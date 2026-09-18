import type { Quote } from "../app/live/types";

export function parseQuote(payload: unknown, symbol: string, receivedAt: string, entitlement: Quote["entitlement"]): Quote {
  if (!payload || typeof payload !== "object") throw new Error("Invalid quote payload");
  const p = payload as Record<string, unknown>;
  if (p.status === "error") throw new Error("Market data provider rejected the request");
  const price = Number(p.close), stamp = Number(p.timestamp), previousClose = Number(p.previous_close);
  if (p.symbol !== symbol || p.currency !== "USD" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stamp) || stamp < 946684800) throw new Error("Incomplete or mismatched quote");
  const quotedAt = new Date(stamp * 1000).toISOString();
  if (Date.parse(quotedAt) > Date.parse(receivedAt) + 60_000) throw new Error("Future-dated quote");
  return { symbol, price, previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
    currency: "USD", quotedAt, receivedAt, source: "Twelve Data / quote", entitlement };
}

/** Server-only credentials; maximum 20 requests per refresh, bounded by held symbols. */
export async function fetchQuotes(symbols: string[], key: string, entitlement: Quote["entitlement"], fetcher: typeof fetch = fetch, now = new Date()) {
  const unique = [...new Set(symbols)].filter(s => /^[A-Z0-9.-]{1,16}$/.test(s)).slice(0, 20);
  const settled = await Promise.allSettled(unique.map(async symbol => {
    const url = new URL("https://api.twelvedata.com/quote");
    url.searchParams.set("symbol", symbol); url.searchParams.set("prepost", "false");
    const response = await fetcher(url, { headers: { authorization: `apikey ${key}` }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
    return parseQuote(await response.json(), symbol, now.toISOString(), entitlement);
  }));
  return { quotes: settled.flatMap(r => r.status === "fulfilled" ? [r.value] : []), failed: unique.filter((_, i) => settled[i].status === "rejected") };
}
