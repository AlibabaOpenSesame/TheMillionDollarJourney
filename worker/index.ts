import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { getUsdCnyRate, unavailableUsdCnyQuote } from "./fx";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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

type Attributes = Record<string, string>;

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

const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const USER_AGENT = "IBKR-Portfolio-Panorama/1.0";
const RETRYABLE_FLEX_ERRORS = new Set(["1001", "1003", "1004", "1005", "1006", "1007", "1008", "1009", "1018", "1019", "1021"]);

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

function decodeXml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(raw: string): Attributes {
  const attributes: Attributes = {};
  const matcher = /([:\w-]+)\s*=\s*"([^"]*)"/g;
  for (const match of raw.matchAll(matcher)) attributes[match[1]] = decodeXml(match[2]);
  return attributes;
}

function tags(xml: string, name: string): Attributes[] {
  const matcher = new RegExp(`<${name}\\b([^>]*)/?>`, "gi");
  return [...xml.matchAll(matcher)].map((match) => parseAttributes(match[1]));
}

function elementText(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function field(row: Attributes | undefined, ...names: string[]) {
  if (!row) return "";
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && row[key] !== "") return row[key];
  }
  return "";
}

function number(row: Attributes | undefined, ...names: string[]) {
  const raw = field(row, ...names).replaceAll(",", "").replaceAll("%", "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function mostRecentDate(rows: Attributes[]) {
  return rows
    .flatMap((row) => [field(row, "reportDate", "date", "toDate", "periodEndDate", "tradeDate")])
    .map(normalizeDate)
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
}

function flexError(xml: string) {
  const status = elementText(xml, "Status");
  if (status.toLowerCase() !== "fail") return null;
  return {
    code: elementText(xml, "ErrorCode"),
    message: elementText(xml, "ErrorMessage") || "IBKR Flex request failed",
  };
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestFlexStatement(env: Env) {
  if (!env.IBKR_FLEX_TOKEN || !env.IBKR_FLEX_QUERY_ID) {
    throw new Error("IBKR Flex token or query ID is not configured");
  }

  const sendUrl = new URL(`${FLEX_BASE}/SendRequest`);
  sendUrl.searchParams.set("t", env.IBKR_FLEX_TOKEN);
  sendUrl.searchParams.set("q", env.IBKR_FLEX_QUERY_ID);
  sendUrl.searchParams.set("v", "3");

  const sendResponse = await fetch(sendUrl, { headers: { "user-agent": USER_AGENT } });
  const sendXml = await sendResponse.text();
  if (!sendResponse.ok) throw new Error(`IBKR SendRequest returned HTTP ${sendResponse.status}`);
  const sendError = flexError(sendXml);
  if (sendError) throw new Error(`IBKR ${sendError.code}: ${sendError.message}`);

  const referenceCode = elementText(sendXml, "ReferenceCode");
  if (!referenceCode) throw new Error("IBKR did not return a Flex reference code");

  const retryDelays = [5_000, 10_000, 20_000, 30_000];
  let lastError = "IBKR statement was not ready";
  for (const waitMs of retryDelays) {
    await delay(waitMs);
    const receiveUrl = new URL(`${FLEX_BASE}/GetStatement`);
    receiveUrl.searchParams.set("t", env.IBKR_FLEX_TOKEN);
    receiveUrl.searchParams.set("q", referenceCode);
    receiveUrl.searchParams.set("v", "3");
    const response = await fetch(receiveUrl, { headers: { "user-agent": USER_AGENT } });
    const xml = await response.text();
    if (!response.ok) {
      lastError = `IBKR GetStatement returned HTTP ${response.status}`;
      continue;
    }
    const error = flexError(xml);
    if (!error) return xml;
    lastError = `IBKR ${error.code}: ${error.message}`;
    if (!RETRYABLE_FLEX_ERRORS.has(error.code)) throw new Error(lastError);
  }

  throw new Error(lastError);
}

function parseStatement(xml: string) {
  const openPositions = tags(xml, "OpenPosition");
  const navRows = [
    ...tags(xml, "NetAssetValue"),
    ...tags(xml, "EquitySummaryByReportDateInBase"),
    ...tags(xml, "EquitySummaryInBase"),
  ];
  const changeRows = tags(xml, "ChangeInNAV");
  const cashRows = tags(xml, "CashReportCurrency");
  const marginRows = [...tags(xml, "MarginSummary"), ...tags(xml, "MarginReport")];
  const performanceRows = [
    ...tags(xml, "RealizedUnrealizedPerformanceSummary"),
    ...tags(xml, "MtmPerformanceSummary"),
    ...tags(xml, "MarkToMarketPerformanceSummary"),
  ];
  const accountRows = tags(xml, "AccountInformation");
  const allRows = [...openPositions, ...navRows, ...changeRows, ...cashRows, ...performanceRows];
  const asOf = mostRecentDate(allRows);
  if (!asOf) throw new Error("The Flex query did not include a report date");

  const performanceBySymbol = new Map<string, Attributes>();
  for (const row of performanceRows) {
    const symbol = field(row, "symbol", "underlyingSymbol");
    if (symbol) performanceBySymbol.set(symbol, row);
  }

  const positions: ParsedPosition[] = openPositions
    .map((row, index) => {
      const symbol = field(row, "symbol", "underlyingSymbol", "description") || `POSITION-${index + 1}`;
      const performance = performanceBySymbol.get(symbol);
      const quantity = number(row, "position", "quantity");
      const assetClass = field(row, "assetCategory", "assetClass") || "STK";
      return {
        contractKey: field(row, "conid", "contractID", "ibOrderID") || `${assetClass}-${symbol}-${field(row, "expiry", "putCall", "strike") || index}`,
        symbol,
        name: field(row, "description", "securityDescription") || symbol,
        assetClass,
        currency: field(row, "currency") || "USD",
        quantity,
        price: number(row, "markPrice", "closePrice", "price"),
        averagePrice: number(row, "costBasisPrice", "openPrice", "averagePrice"),
        marketValue: number(row, "positionValue", "marketValue"),
        dailyPnl: number(performance, "mtmPnl", "total", "pnl"),
        unrealizedPnl: number(row, "fifoPnlUnrealized", "unrealizedPnl", "unrealizedTotal"),
      };
    })
    .filter((position) => position.quantity !== 0);

  const baseCash = cashRows.find((row) => ["BASE", "USD"].includes(field(row, "currency", "currencyPrimary"))) ?? cashRows[0];
  const change = changeRows.at(-1);
  const nav = navRows.at(-1);
  const margin = marginRows.at(-1);
  const account = accountRows.at(-1);
  const totalCash = number(baseCash, "endingCash", "cash", "cashBalance");
  const grossPositionValue = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const netLiquidation =
    number(change, "endingValue", "endingNAV") ||
    number(nav, "total", "netLiquidation", "netAssetValue") ||
    number(baseCash, "netLiquidationValue") ||
    grossPositionValue + totalCash;
  if (!netLiquidation) throw new Error("The Flex query did not include net liquidation value");

  const unrealizedPnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0) ||
    performanceRows.reduce((sum, row) => sum + number(row, "fifoPnlUnrealized", "unrealizedTotal"), 0);
  const realizedYtd = performanceRows.reduce((sum, row) => sum + number(row, "fifoPnlRealized", "realizedTotal", "realizedPnl"), 0);
  const dailyPnlFromPositions = positions.reduce((sum, position) => sum + position.dailyPnl, 0);
  const dailyPnl = dailyPnlFromPositions || number(change, "realized", "realizedTotal") + number(change, "changeInUnrealized", "changeUnrealized");
  const rawTwr = number(change, "twr", "timeWeightedReturn");

  return {
    asOf,
    currency: field(account, "baseCurrency", "currency") || field(baseCash, "currency") || "USD",
    netLiquidation,
    totalCash,
    availableFunds: number(margin, "availableFunds", "currentAvailableFunds") || totalCash,
    buyingPower: number(margin, "buyingPower", "currentBuyingPower") || totalCash,
    grossPositionValue,
    dailyPnl,
    ytdReturn: rawTwr / 100,
    unrealizedPnl,
    leverage: grossPositionValue / netLiquidation,
    realizedYtd,
    positions,
  };
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

async function syncPortfolio(env: Env, trigger: SyncTrigger = "manual") {
  await ensureSchema(env.DB);
  const startedAt = new Date().toISOString();
  const run = await env.DB.prepare(
    "INSERT INTO sync_runs (started_at, status, trigger) VALUES (?, 'running', ?)",
  ).bind(startedAt, trigger).run();
  const runId = run.meta.last_row_id;

  try {
    const xml = await requestFlexStatement(env);
    const parsed = parseStatement(xml);
    const stored = await storeStatement(env, parsed);
    await env.DB.prepare(
      "UPDATE sync_runs SET completed_at = ?, status = 'success', as_of = ? WHERE id = ?",
    ).bind(new Date().toISOString(), parsed.asOf, runId).run();
    return stored;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown synchronization error";
    await env.DB.prepare(
      "UPDATE sync_runs SET completed_at = ?, status = 'failed', error = ? WHERE id = ?",
    ).bind(new Date().toISOString(), message.slice(0, 500), runId).run();
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

async function readPortfolio(env: Env) {
  await ensureSchema(env.DB);
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
    FROM portfolio_positions WHERE as_of = ? ORDER BY ABS(market_value) DESC`).bind(snapshot.asOf).all();
  const history = await env.DB.prepare(`SELECT as_of AS date, net_liquidation AS value
    FROM portfolio_snapshots ORDER BY as_of DESC LIMIT 260`).all();

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
    console.log("Starting scheduled IBKR portfolio sync", {
      cron: controller.cron,
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
    });
    try {
      const result = await syncPortfolio(env, "scheduled");
      console.log("Scheduled IBKR portfolio sync completed", result);
    } catch (error) {
      console.error("Scheduled IBKR portfolio sync failed", error);
      throw error;
    }
  },
};

export default worker;
