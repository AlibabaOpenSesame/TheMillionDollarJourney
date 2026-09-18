import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { getUsdCnyRate, unavailableUsdCnyQuote } from "./fx";
import { fetchIbkrFlex, parseStatement, isCorrectNYSyncTime } from "./ibkr";
import { writeLatestCache, writeSyncStatus } from "./cache";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CACHE?: KVNamespace;
  IBKR_FLEX_TOKEN?: string;
  IBKR_FLEX_QUERY_ID?: string;
  IBKR_SYNC_SECRET?: string;
  IBKR_MANUAL_IMPORT_SECRET?: string;
  TWELVE_DATA_API_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
}

type SyncTrigger = "manual" | "scheduled" | "recovery" | "import";

type ParsedPosition = {
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

type ImportedPortfolio = {
  asOf: string;
  updatedAt?: string;
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
  navHistory: Array<{ date: string; value: number }>;
  positions: ParsedPosition[];
};


const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    as_of TEXT PRIMARY KEY,
    synced_at TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    net_liquidation REAL NOT NULL,
    previous_nav REAL NOT NULL DEFAULT 0,
    total_cash REAL NOT NULL DEFAULT 0,
    available_funds REAL NOT NULL DEFAULT 0,
    buying_power REAL NOT NULL DEFAULT 0,
    gross_position_value REAL NOT NULL DEFAULT 0,
    daily_pnl REAL NOT NULL DEFAULT 0,
    daily_return REAL NOT NULL DEFAULT 0,
    week_return REAL NOT NULL DEFAULT 0,
    ytd_return REAL NOT NULL DEFAULT 0,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    leverage REAL NOT NULL DEFAULT 0,
    realized_ytd REAL NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'IBKR Flex Web Service'
  )`,
  `CREATE TABLE IF NOT EXISTS portfolio_positions (
    as_of TEXT NOT NULL,
    contract_key TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    asset_class TEXT NOT NULL DEFAULT 'STK',
    currency TEXT NOT NULL DEFAULT 'USD',
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    average_price REAL NOT NULL DEFAULT 0,
    market_value REAL NOT NULL DEFAULT 0,
    daily_pnl REAL NOT NULL DEFAULT 0,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (as_of, contract_key),
    FOREIGN KEY (as_of) REFERENCES portfolio_snapshots(as_of) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS portfolio_positions_as_of_idx ON portfolio_positions(as_of)",
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    as_of TEXT,
    error TEXT,
    trigger TEXT NOT NULL DEFAULT 'manual'
  )`,
  `CREATE TABLE IF NOT EXISTS trades (
    trade_id TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT,
    quantity REAL,
    price REAL,
    commission REAL,
    currency TEXT DEFAULT 'USD',
    trade_time TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(trade_date)",
  `CREATE TABLE IF NOT EXISTS fx_rates (
    pair TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    quoted_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    source TEXT NOT NULL
  )`,
];

async function ensureSchema(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store, max-age=0");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateImportedPortfolio(value: unknown): ImportedPortfolio {
  if (!value || typeof value !== "object") throw new Error("Invalid portfolio payload");
  const portfolio = value as Partial<ImportedPortfolio>;
  if (!isIsoDate(portfolio.asOf)) throw new Error("Invalid portfolio asOf date");
  if (typeof portfolio.currency !== "string" || !portfolio.currency) throw new Error("Invalid portfolio currency");

  const numericFields: Array<keyof ImportedPortfolio> = [
    "netLiquidation", "previousNav", "totalCash", "availableFunds", "buyingPower",
    "grossPositionValue", "dailyPnl", "dailyReturn", "weekReturn", "ytdReturn",
    "unrealizedPnl", "leverage", "realizedYtd",
  ];
  for (const key of numericFields) {
    if (!isFiniteNumber(portfolio[key])) throw new Error(`Invalid numeric field: ${key}`);
  }

  if (!Array.isArray(portfolio.navHistory) || portfolio.navHistory.length > 500) {
    throw new Error("Invalid NAV history");
  }
  for (const point of portfolio.navHistory) {
    if (!isIsoDate(point?.date) || !isFiniteNumber(point?.value)) throw new Error("Invalid NAV history point");
  }

  if (!Array.isArray(portfolio.positions) || portfolio.positions.length > 500) {
    throw new Error("Invalid positions list");
  }
  for (const position of portfolio.positions) {
    if (!position || typeof position !== "object" || typeof position.contractKey !== "string" || !position.contractKey ||
      typeof position.symbol !== "string" || !position.symbol || typeof position.name !== "string" ||
      typeof position.assetClass !== "string" || typeof position.currency !== "string") {
      throw new Error("Invalid position identity");
    }
    for (const key of ["quantity", "price", "averagePrice", "marketValue", "dailyPnl", "unrealizedPnl"] as const) {
      if (!isFiniteNumber(position[key])) throw new Error(`Invalid position field: ${key}`);
    }
  }

  return portfolio as ImportedPortfolio;
}

async function storeStatement(env: Env, parsed: ReturnType<typeof parseStatement>) {
  const db = env.DB;
  const previous = await db.prepare(
    "SELECT net_liquidation AS netLiquidation FROM portfolio_snapshots WHERE as_of < ? ORDER BY as_of DESC LIMIT 1",
  ).bind(parsed.asOf).first<{ netLiquidation: number }>();
  const weekBase = await db.prepare(
    "SELECT net_liquidation AS netLiquidation FROM portfolio_snapshots WHERE as_of < ? ORDER BY as_of DESC LIMIT 1 OFFSET 4",
  ).bind(parsed.asOf).first<{ netLiquidation: number }>();
  const yearBase = await db.prepare(
    "SELECT net_liquidation AS netLiquidation FROM portfolio_snapshots WHERE as_of >= ? AND as_of < ? ORDER BY as_of ASC LIMIT 1",
  ).bind(`${parsed.asOf.slice(0, 4)}-01-01`, parsed.asOf).first<{ netLiquidation: number }>();

  const previousNav = previous?.netLiquidation ?? parsed.netLiquidation;
  const dailyReturn = previousNav ? parsed.netLiquidation / previousNav - 1 : 0;
  const weekReturn = weekBase?.netLiquidation ? parsed.netLiquidation / weekBase.netLiquidation - 1 : dailyReturn;
  const ytdReturn = parsed.ytdReturn || (yearBase?.netLiquidation ? parsed.netLiquidation / yearBase.netLiquidation - 1 : 0);
  const syncedAt = new Date().toISOString();

  const statements = [
    db.prepare(`INSERT INTO portfolio_snapshots (
      as_of, synced_at, currency, net_liquidation, previous_nav, total_cash,
      available_funds, buying_power, gross_position_value, daily_pnl,
      daily_return, week_return, ytd_return, unrealized_pnl, leverage,
      realized_ytd, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(as_of) DO UPDATE SET
      synced_at=excluded.synced_at, currency=excluded.currency,
      net_liquidation=excluded.net_liquidation, previous_nav=excluded.previous_nav,
      total_cash=excluded.total_cash, available_funds=excluded.available_funds,
      buying_power=excluded.buying_power, gross_position_value=excluded.gross_position_value,
      daily_pnl=excluded.daily_pnl, daily_return=excluded.daily_return,
      week_return=excluded.week_return, ytd_return=excluded.ytd_return,
      unrealized_pnl=excluded.unrealized_pnl, leverage=excluded.leverage,
      realized_ytd=excluded.realized_ytd, source=excluded.source`).bind(
        parsed.asOf, syncedAt, parsed.currency, parsed.netLiquidation, previousNav,
        parsed.totalCash, parsed.availableFunds, parsed.buyingPower,
        parsed.grossPositionValue, parsed.dailyPnl, dailyReturn, weekReturn,
        ytdReturn, parsed.unrealizedPnl, parsed.leverage, parsed.realizedYtd,
        "IBKR Flex Web Service",
      ),
    db.prepare("DELETE FROM portfolio_positions WHERE as_of = ?").bind(parsed.asOf),
    ...parsed.positions.map((position) => db.prepare(`INSERT INTO portfolio_positions (
      as_of, contract_key, symbol, name, asset_class, currency, quantity, price,
      average_price, market_value, daily_pnl, unrealized_pnl
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      parsed.asOf, position.contractKey, position.symbol, position.name,
      position.assetClass, position.currency, position.quantity, position.price,
      position.averagePrice, position.marketValue, position.dailyPnl,
      position.unrealizedPnl,
    )),
  ];
  if (parsed.trades?.length) {
    statements.push(
      ...parsed.trades.map((trade) => db.prepare(`INSERT INTO trades (
        trade_id, trade_date, symbol, side, quantity, price, commission, currency, trade_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_id) DO UPDATE SET
        trade_date=excluded.trade_date, symbol=excluded.symbol, side=excluded.side,
        quantity=excluded.quantity, price=excluded.price, commission=excluded.commission,
        currency=excluded.currency, trade_time=excluded.trade_time`).bind(
        trade.tradeId, trade.tradeDate, trade.symbol, trade.side, trade.quantity,
        trade.price, trade.commission, trade.currency, trade.tradeTime,
      )),
    );
  }
  await db.batch(statements);
  return { ...parsed, previousNav, dailyReturn, weekReturn, ytdReturn, syncedAt };
}

function upsertSnapshotStatement(db: D1Database, snapshot: SnapshotRow) {
  return db.prepare(`INSERT INTO portfolio_snapshots (
    as_of, synced_at, currency, net_liquidation, previous_nav, total_cash,
    available_funds, buying_power, gross_position_value, daily_pnl,
    daily_return, week_return, ytd_return, unrealized_pnl, leverage,
    realized_ytd, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(as_of) DO UPDATE SET
    synced_at=excluded.synced_at, currency=excluded.currency,
    net_liquidation=excluded.net_liquidation, previous_nav=excluded.previous_nav,
    total_cash=excluded.total_cash, available_funds=excluded.available_funds,
    buying_power=excluded.buying_power, gross_position_value=excluded.gross_position_value,
    daily_pnl=excluded.daily_pnl, daily_return=excluded.daily_return,
    week_return=excluded.week_return, ytd_return=excluded.ytd_return,
    unrealized_pnl=excluded.unrealized_pnl, leverage=excluded.leverage,
    realized_ytd=excluded.realized_ytd, source=excluded.source`).bind(
      snapshot.asOf, snapshot.syncedAt, snapshot.currency, snapshot.netLiquidation,
      snapshot.previousNav, snapshot.totalCash, snapshot.availableFunds,
      snapshot.buyingPower, snapshot.grossPositionValue, snapshot.dailyPnl,
      snapshot.dailyReturn, snapshot.weekReturn, snapshot.ytdReturn,
      snapshot.unrealizedPnl, snapshot.leverage, snapshot.realizedYtd,
      snapshot.source,
    );
}

async function storeImportedPortfolio(env: Env, imported: ImportedPortfolio) {
  await ensureSchema(env.DB);
  const syncedAt = imported.updatedAt && !Number.isNaN(Date.parse(imported.updatedAt))
    ? new Date(imported.updatedAt).toISOString()
    : new Date().toISOString();
  const history = [...new Map(imported.navHistory.map((point) => [point.date, point])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));

  const historyStatements = history.map((point, index) => {
    const previous = history[index - 1]?.value ?? point.value;
    const weekBase = history[Math.max(0, index - 5)]?.value ?? previous;
    const yearBase = history.find((candidate) => candidate.date.startsWith(point.date.slice(0, 4)))?.value ?? previous;
    return upsertSnapshotStatement(env.DB, {
      asOf: point.date,
      syncedAt,
      currency: imported.currency,
      netLiquidation: point.value,
      previousNav: previous,
      totalCash: 0,
      availableFunds: 0,
      buyingPower: 0,
      grossPositionValue: point.value,
      dailyPnl: point.value - previous,
      dailyReturn: previous ? point.value / previous - 1 : 0,
      weekReturn: weekBase ? point.value / weekBase - 1 : 0,
      ytdReturn: yearBase ? point.value / yearBase - 1 : 0,
      unrealizedPnl: 0,
      leverage: 1,
      realizedYtd: 0,
      source: "IBKR connected account history",
    });
  });

  const current: SnapshotRow = {
    ...imported,
    syncedAt,
    source: "IBKR connected account",
  };
  const statements = [
    ...historyStatements,
    upsertSnapshotStatement(env.DB, current),
    env.DB.prepare("DELETE FROM portfolio_positions WHERE as_of = ?").bind(imported.asOf),
    ...imported.positions.map((position) => env.DB.prepare(`INSERT INTO portfolio_positions (
      as_of, contract_key, symbol, name, asset_class, currency, quantity, price,
      average_price, market_value, daily_pnl, unrealized_pnl
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      imported.asOf, position.contractKey, position.symbol, position.name,
      position.assetClass, position.currency, position.quantity, position.price,
      position.averagePrice, position.marketValue, position.dailyPnl,
      position.unrealizedPnl,
    )),
  ];
  await env.DB.batch(statements);
  await env.DB.prepare(
    "INSERT INTO sync_runs (started_at, completed_at, status, as_of, trigger) VALUES (?, ?, 'success', ?, 'import')",
  ).bind(syncedAt, new Date().toISOString(), imported.asOf).run();
  return { asOf: imported.asOf, syncedAt };
}

export async function syncPortfolio(env: Env, trigger: SyncTrigger = "manual") {
  // Production schema is owned by versioned migrations, never request-time DDL.
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(
    "INSERT INTO sync_runs (started_at, status, trigger) VALUES (?, 'running', ?)",
  ).bind(startedAt, trigger).run();
  const runId = run.meta.last_row_id;

  try {
    if (!env.IBKR_FLEX_TOKEN || !env.IBKR_FLEX_QUERY_ID) {
      throw new Error("IBKR Flex token or query ID is not configured");
    }
    const xml = await fetchIbkrFlex({ token: env.IBKR_FLEX_TOKEN, queryId: env.IBKR_FLEX_QUERY_ID });
    const parsed = parseStatement(xml);
    const stored = await storeStatement(env, parsed);
    const completedAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE sync_runs SET completed_at = ?, status = 'success', as_of = ? WHERE id = ?",
    ).bind(completedAt, parsed.asOf, runId).run();
    if (env.CACHE) {
      await writeLatestCache(
        env.CACHE,
        {
          tradeDate: parsed.asOf,
          updatedAt: stored.syncedAt,
          nav: parsed.netLiquidation,
          cash: parsed.totalCash,
          marketValue: parsed.grossPositionValue,
          unrealizedPnl: parsed.unrealizedPnl,
          currency: parsed.currency,
        },
        parsed.positions.map((p) => ({
          symbol: p.symbol,
          quantity: p.quantity,
          price: p.price,
          marketValue: p.marketValue,
          averagePrice: p.averagePrice,
          unrealizedPnl: p.unrealizedPnl,
        })),
        { status: "success", updatedAt: completedAt, asOf: parsed.asOf, trigger },
      );
    }
    return stored;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown synchronization error";
    const failedAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE sync_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?",
    ).bind(failedAt, message.slice(0, 500), runId).run();
    if (env.CACHE) {
      await writeSyncStatus(env.CACHE, {
        status: "failed",
        updatedAt: failedAt,
        asOf: null,
        trigger,
        error: message.slice(0, 500),
      }).catch(() => undefined);
    }
    throw error;
  }
}

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

type SyncRunRow = {
  status: string;
  startedAt: string;
  completedAt: string | null;
  asOf: string | null;
  error: string | null;
  trigger: SyncTrigger;
};

const SCHEDULE_HOUR_UTC = 23;
const SCHEDULE_MINUTE_UTC = 30;

function latestScheduledTick(now = new Date()) {
  const tick = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    SCHEDULE_HOUR_UTC,
    SCHEDULE_MINUTE_UTC,
  ));
  if (tick.getTime() > now.getTime()) tick.setUTCDate(tick.getUTCDate() - 1);
  return tick;
}

function shouldTriggerRecovery(configured: boolean, lastRun: SyncRunRow | null, now = new Date()) {
  if (!configured) return false;
  const latestTick = latestScheduledTick(now).getTime();
  const lastStartedAt = lastRun?.startedAt ? Date.parse(lastRun.startedAt) : Number.NaN;
  return !Number.isFinite(lastStartedAt) || lastStartedAt < latestTick;
}

export async function readPortfolio(env: { DB: D1Database }) {
  const snapshot = await env.DB.prepare(`SELECT
    as_of AS asOf, synced_at AS syncedAt, currency, net_liquidation AS netLiquidation,
    previous_nav AS previousNav, total_cash AS totalCash, available_funds AS availableFunds,
    buying_power AS buyingPower, gross_position_value AS grossPositionValue,
    daily_pnl AS dailyPnl, daily_return AS dailyReturn, week_return AS weekReturn,
    ytd_return AS ytdReturn, unrealized_pnl AS unrealizedPnl, leverage,
    realized_ytd AS realizedYtd, source
    FROM portfolio_snapshots ORDER BY as_of DESC LIMIT 1`).first<SnapshotRow>();

  const lastRun = await env.DB.prepare(`SELECT status, started_at AS startedAt,
    completed_at AS completedAt, as_of AS asOf, error, trigger
    FROM sync_runs ORDER BY id DESC LIMIT 1`).first<SyncRunRow>();
  if (!snapshot) return { portfolio: null, lastRun };

  const positions = await env.DB.prepare(`SELECT
    contract_key AS contractKey, symbol, name, asset_class AS assetClass, currency,
    quantity, price, average_price AS averagePrice, market_value AS marketValue,
    daily_pnl AS dailyPnl, unrealized_pnl AS unrealizedPnl
    FROM portfolio_positions WHERE as_of = ? ORDER BY ABS(market_value) DESC`).bind(snapshot.asOf).all<ParsedPosition>();
  const history = await env.DB.prepare(`SELECT as_of AS date, net_liquidation AS value
    FROM portfolio_snapshots ORDER BY as_of DESC LIMIT 260`).all<{ date: string; value: number }>();

  return {
    portfolio: {
      ...snapshot,
      updatedAt: snapshot.syncedAt,
      positions: positions.results,
      navHistory: [...history.results].reverse(),
    },
    lastRun,
  };
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "www.openinvestai.com") {
      url.hostname = "openinvestai.com";
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === "/api/portfolio" && request.method === "GET") {
      if (!env.DB) return json({ configured: false, portfolio: null, lastRun: null, fx: null }, { status: 503 });
      const data = await readPortfolio(env);
      const configured = Boolean(env.IBKR_FLEX_TOKEN && env.IBKR_FLEX_QUERY_ID);
      const syncTriggered = shouldTriggerRecovery(configured, data.lastRun);
      if (syncTriggered) {
        ctx.waitUntil(syncPortfolio(env, "recovery").catch((error) => {
          console.error("IBKR catch-up synchronization failed", error);
        }));
      }
      let fx = null;
      if (url.searchParams.get("displayCurrency") === "CNY") {
        fx = await getUsdCnyRate(env).catch(() => unavailableUsdCnyQuote());
      }
      return json({
        configured,
        syncTriggered,
        latestScheduledAt: latestScheduledTick().toISOString(),
        fx,
        ...data,
      });
    }

    if (url.pathname === "/api/portfolio/sync" && request.method === "POST") {
      const suppliedSecret = request.headers.get("authorization");
      if (!env.IBKR_SYNC_SECRET || suppliedSecret !== `Bearer ${env.IBKR_SYNC_SECRET}`) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }
      try {
        const portfolio = await syncPortfolio(env, "manual");
        return json({ ok: true, asOf: portfolio.asOf });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Synchronization failed" }, { status: 502 });
      }
    }

    if (url.pathname === "/api/portfolio/import" && request.method === "POST") {
      const suppliedSecret = request.headers.get("authorization");
      const authorized = [env.IBKR_SYNC_SECRET, env.IBKR_MANUAL_IMPORT_SECRET]
        .filter(Boolean)
        .some((secret) => suppliedSecret === `Bearer ${secret}`);
      if (!authorized) {
        return json({ error: "Unauthorized" }, { status: 401 });
      }
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 1_000_000) return json({ error: "Payload too large" }, { status: 413 });
      try {
        const imported = validateImportedPortfolio(await request.json());
        const stored = await storeImportedPortfolio(env, imported);
        return json({ ok: true, ...stored });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid portfolio payload" }, { status: 400 });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env) {
    const when = new Date(controller.scheduledTime);
    if (!isCorrectNYSyncTime(when)) {
      console.log("Skipping scheduled IBKR sync (not 18:00 America/New_York)", {
        cron: controller.cron,
        scheduledTime: when.toISOString(),
      });
      return;
    }
    console.log("Starting scheduled IBKR portfolio sync", {
      cron: controller.cron,
      scheduledTime: when.toISOString(),
    });
    try {
      const result = await syncPortfolio(env, "scheduled");
      console.log("Scheduled IBKR portfolio sync completed", {
        asOf: result.asOf,
        syncedAt: result.syncedAt,
      });
    } catch (error) {
      console.error("Scheduled IBKR portfolio sync failed", error);
      throw error;
    }
  },
};

export default worker;
