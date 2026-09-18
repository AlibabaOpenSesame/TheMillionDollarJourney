import { headers } from "next/headers";
import {
  PortfolioApiResponse,
  PortfolioData,
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

function candidatesFromHeaders(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const list: string[] = [];
  if (host) list.push(`${protocol}://${host}`);
  // Production custom domains as last-resort self fetch targets during SSR.
  for (const origin of ["https://openinvestai.com", "https://www.openinvestai.com"]) {
    if (!list.includes(origin)) list.push(origin);
  }
  return list;
}

async function fetchPortfolio(origin: string, displayCurrency: "USD" | "CNY") {
  const url = new URL("/api/portfolio", origin);
  if (displayCurrency === "CNY") url.searchParams.set("displayCurrency", "CNY");
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Portfolio API HTTP ${response.status}`);
  return (await response.json()) as PortfolioApiResponse;
}

/** Server-side portfolio load for first paint. Live API wins; fallback only on failure/empty. */
export async function loadPortfolio(displayCurrency: "USD" | "CNY" = "USD"): Promise<LoadedPortfolio> {
  const requestHeaders = await headers();
  const emptyMeta = {
    configured: false,
    lastRun: null as PortfolioApiResponse["lastRun"],
    fx: null as PortfolioApiResponse["fx"],
    syncTriggered: false,
    latestScheduledAt: null as string | null,
  };

  let lastError: unknown = null;
  for (const origin of candidatesFromHeaders(requestHeaders)) {
    try {
      const data = await fetchPortfolio(origin, displayCurrency);
      if (!data.portfolio) {
        return {
          portfolio: verifiedFallbackPortfolio,
          usingFallback: true,
          configured: Boolean(data.configured),
          lastRun: data.lastRun,
          fx: data.fx ?? null,
          syncTriggered: Boolean(data.syncTriggered),
          latestScheduledAt: data.latestScheduledAt ?? null,
        };
      }
      return {
        portfolio: data.portfolio,
        usingFallback: false,
        configured: Boolean(data.configured),
        lastRun: data.lastRun,
        fx: data.fx ?? null,
        syncTriggered: Boolean(data.syncTriggered),
        latestScheduledAt: data.latestScheduledAt ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  console.error("loadPortfolio fallback", lastError);
  return { portfolio: verifiedFallbackPortfolio, usingFallback: true, ...emptyMeta };
}
