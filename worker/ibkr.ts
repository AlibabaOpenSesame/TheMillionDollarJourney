/** IBKR Flex Web Service v3 client + statement parse (no secrets in logs). */
export type Attributes = Record<string, string>;

export type ParsedPosition = {
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

export type ParsedTrade = {
  tradeId: string;
  tradeDate: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  commission: number;
  currency: string;
  tradeTime: string;
};

export type ParsedStatement = {
  asOf: string;
  currency: string;
  netLiquidation: number;
  totalCash: number;
  availableFunds: number;
  buyingPower: number;
  grossPositionValue: number;
  dailyPnl: number;
  ytdReturn: number;
  unrealizedPnl: number;
  leverage: number;
  realizedYtd: number;
  positions: ParsedPosition[];
  trades: ParsedTrade[];
};

const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";
const USER_AGENT = "OpenInvestAI/1.0";
export const RETRYABLE_FLEX_ERRORS = new Set([
  "1001", "1003", "1004", "1005", "1006", "1007", "1008", "1009", "1018", "1019", "1021",
]);

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

export function tags(xml: string, name: string): Attributes[] {
  const matcher = new RegExp(`<${name}\\b([^>]*)/?>`, "gi");
  return [...xml.matchAll(matcher)].map((match) => parseAttributes(match[1]));
}

function elementText(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

export function field(row: Attributes | undefined, ...names: string[]) {
  if (!row) return "";
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return row[name];
    const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (key && row[key] !== "") return row[key];
  }
  return "";
}

export function number(row: Attributes | undefined, ...names: string[]) {
  const raw = field(row, ...names).replaceAll(",", "").replaceAll("%", "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeDate(value: string) {
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

export type FlexCredentials = {
  token: string;
  queryId: string;
};

/** SendRequest → ReferenceCode → GetStatement with retryable Flex codes. */
export async function fetchIbkrFlex(creds: FlexCredentials): Promise<string> {
  const sendUrl = new URL(`${FLEX_BASE}/SendRequest`);
  sendUrl.searchParams.set("t", creds.token);
  sendUrl.searchParams.set("q", creds.queryId);
  sendUrl.searchParams.set("v", "3");

  const sendResponse = await fetch(sendUrl, { headers: { "user-agent": USER_AGENT } });
  const sendXml = await sendResponse.text();
  if (!sendResponse.ok) throw new Error(`IBKR SendRequest returned HTTP ${sendResponse.status}`);
  const sendError = flexError(sendXml);
  if (sendError) throw new Error(`IBKR ${sendError.code}: ${sendError.message}`);

  const referenceCode = elementText(sendXml, "ReferenceCode");
  if (!referenceCode) throw new Error("IBKR did not return a Flex reference code");

  const retryDelays = [5_000, 10_000, 20_000, 30_000, 60_000];
  let lastError = "IBKR statement was not ready";
  for (const waitMs of retryDelays) {
    await delay(waitMs);
    const receiveUrl = new URL(`${FLEX_BASE}/GetStatement`);
    receiveUrl.searchParams.set("t", creds.token);
    receiveUrl.searchParams.set("q", referenceCode);
    receiveUrl.searchParams.set("v", "3");
    const response = await fetch(receiveUrl, { headers: { "user-agent": USER_AGENT } });
    const xml = await response.text();
    if (!response.ok) {
      lastError = `IBKR GetStatement returned HTTP ${response.status}`;
      continue;
    }
    // Statement payload (not a FlexStatementResponse envelope) means success.
    if (!xml.includes("<FlexStatementResponse")) return xml;
    const error = flexError(xml);
    if (!error) return xml;
    lastError = `IBKR ${error.code}: ${error.message}`;
    if (!RETRYABLE_FLEX_ERRORS.has(error.code)) throw new Error(lastError);
  }

  throw new Error(lastError);
}

export function parseTrades(xml: string): ParsedTrade[] {
  const rows = [...tags(xml, "Trade"), ...tags(xml, "Order")];
  const trades: ParsedTrade[] = [];
  for (const row of rows) {
    const tradeDate = normalizeDate(field(row, "tradeDate", "dateTime", "reportDate"));
    const symbol = field(row, "symbol", "underlyingSymbol");
    if (!tradeDate || !symbol) continue;
    const tradeId =
      field(row, "tradeID", "ibExecID", "execID", "ibOrderID", "orderID") ||
      `${tradeDate}-${symbol}-${field(row, "quantity")}-${field(row, "tradePrice", "price")}`;
    const buySell = field(row, "buySell", "side").toUpperCase();
    trades.push({
      tradeId,
      tradeDate,
      symbol,
      side: buySell.startsWith("B") ? "BUY" : buySell.startsWith("S") ? "SELL" : buySell || "",
      quantity: number(row, "quantity"),
      price: number(row, "tradePrice", "price"),
      commission: number(row, "ibCommission", "commission"),
      currency: field(row, "currency") || "USD",
      tradeTime: field(row, "dateTime", "tradeTime") || "",
    });
  }
  // Dedupe by tradeId
  return [...new Map(trades.map((t) => [t.tradeId, t])).values()];
}

export function parseStatement(xml: string): ParsedStatement {
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
    trades: parseTrades(xml),
  };
}

/** True when America/New_York local hour is 18 (covers EDT/EST via dual UTC crons). */
export function isCorrectNYSyncTime(date: Date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
  return hour === 18;
}
