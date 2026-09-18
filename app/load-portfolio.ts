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

const PRODUCTION_ORIGIN = "https://openinvestai.com";

function originFromHeaders(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) return null;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return ;
}

/** Server-side portfolio load for first paint. Live API wins; fallback only on failure/empty. */
export async function loadPortfolio(displayCurrency: "USD" | "CNY" = "USD"): Promise<LoadedPortfolio> {
  const requestHeaders = await headers();
  // Workers SSR often lacks Host; always fall back to the public production origin.
  const origin = originFromHeaders(requestHeaders) ?? PRODUCTION_ORIGIN;
  const emptyMeta = {
    configured: false,
    lastRun: null as PortfolioApiResponse["lastRun"],
    fx: null as PortfolioApiResponse["fx"],
    syncTriggered: false,
    latestScheduledAt: null as string | null,
  };

  const tryFetch = async (base: string) => {
    const url = new URL("/api/portfolio", base);
    if (displayCurrency === "CNY") url.searchParams.set("displayCurrency", "CNY");
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error();
    return (await response.json()) as PortfolioApiResponse;
  };

  try {
    let data: PortfolioApiResponse;
    try {
      data = await tryFetch(origin);
    } catch (firstError) {
      if (origin !== PRODUCTION_ORIGIN) {
        data = await tryFetch(PRODUCTION_ORIGIN);
      } else {
        throw firstError;
      }
    }
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
  } catch {
    return { portfolio: verifiedFallbackPortfolio, usingFallback: true, ...emptyMeta };
  }
}
