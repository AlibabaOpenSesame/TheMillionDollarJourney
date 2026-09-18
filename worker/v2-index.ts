import handler from "vinext/server/app-router-entry";
import { syncPortfolio } from "./index";
import { readLiveDashboard, recordVerified, refreshMarket, withLock, type LiveEnv } from "./live-service";
import { seedV2 } from "./seed-v2";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });

async function syncVerified(env: LiveEnv, trigger: "manual" | "scheduled") {
  return withLock(env.DB, "ibkr-sync", async () => {
    const result = await syncPortfolio(env, trigger);
    await recordVerified(env, result.asOf, result.netLiquidation, result.syncedAt);
    return { asOf: result.asOf, importedAt: result.syncedAt };
  }, 240);
}

export default {
  async fetch(request: Request, env: LiveEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/v2/dashboard" && request.method === "GET") {
      try { return json(await readLiveDashboard(env)); }
      catch { console.error("v2 dashboard storage unavailable"); return json({ error: "Data temporarily unavailable" }, 503); }
    }
    if (url.pathname.startsWith("/api/")) {
      const authorized = Boolean(env.IBKR_SYNC_SECRET) && request.headers.get("authorization") === `Bearer ${env.IBKR_SYNC_SECRET}`;
      if (!authorized) return json({ error: "Unauthorized" }, 401);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      try {
        if (url.pathname === "/api/v2/bootstrap") return json({ result: await seedV2(env.DB) });
        if (url.pathname === "/api/v2/sync") return json({ result: await syncVerified(env, "manual") });
        if (url.pathname === "/api/v2/quotes/refresh") return json({ result: await refreshMarket(env) });
      } catch { console.error("v2 authorized refresh failed"); return json({ error: "Refresh failed; previous verified data retained" }, 502); }
      return json({ error: "Not found" }, 404);
    }
    return handler.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: LiveEnv) {
    await seedV2(env.DB);
    if (event.cron === "30 23 * * *") {
      if (env.IBKR_FLEX_TOKEN && env.IBKR_FLEX_QUERY_ID) await syncVerified(env, "scheduled");
    } else {
      await refreshMarket(env, new Date(event.scheduledTime));
    }
  },
};
