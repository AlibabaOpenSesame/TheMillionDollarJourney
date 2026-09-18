import type { LiveDashboard } from "./types";
import { quoteState, snapshotState } from "./valuation";
type Locale = "zh" | "en";
const money = (n?: number | null) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const percent = (n?: number | null) => n == null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;

export function SystemStatus({ data, locale, now, offline }: { data: LiveDashboard; locale: Locale; now: Date; offline: boolean }) {
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  const states = data.quotes.map(q => quoteState(q, now, data.market));
  const feed = offline ? "STALE" : !states.length ? "UNAVAILABLE" : states.includes("STALE") ? "STALE" : states.every(s => s === "LIVE") ? "LIVE" : data.market.state === "CLOSED" ? "MARKET CLOSED" : "DELAYED";
  const age = data.estimate.quotedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(data.estimate.quotedAt)) / 1000)) : null;
  const sync = data.sync.status === "running" && data.sync.startedAt && now.getTime() - Date.parse(data.sync.startedAt) < 300_000 ? "SYNCING" : data.sync.status === "failed" ? t("同步失败", "SYNC FAILED") : !data.sync.configured ? t("IBKR 自动同步待配置", "IBKR SYNC NOT CONFIGURED") : t("IBKR 只读同步", "IBKR READ-ONLY SYNC");
  return <div className="v2-system-status" aria-label={t("数据状态", "Data status")}><span className={feed === "LIVE" ? "up" : "subtle"}>● {t("行情", "QUOTES")} / {feed}</span><span>{t("最近报价", "LAST QUOTE")} {age === null ? "—" : age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`} {age === null ? "" : t("前", "ago")}</span><span>{data.portfolio ? `✓ IBKR VERIFIED${snapshotState(data.portfolio.asOf, now) === "STALE" ? " / STALE" : ""}` : "IBKR UNAVAILABLE"}</span><span>{sync}</span><span>{t("采样间隔", "SAMPLING")} {data.feed.intervalSeconds}s</span></div>;
}

export function AdditionalInsights({ data, locale }: { data: LiveDashboard; locale: Locale }) {
  const t = (zh: string, en: string) => locale === "zh" ? zh : en, p = data.portfolio;
  const movers = data.quotes.filter(q => q.previousClose && q.previousClose > 0).map(q => ({ symbol: q.symbol, change: q.price / q.previousClose! - 1 })).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const assets = p ? [...p.positions.map(position => ({ name: position.symbol, value: position.marketValue })), { name: t("现金", "Cash"), value: p.totalCash }] : [];
  const totalAbs = assets.reduce((sum, a) => sum + Math.abs(a.value), 0);
  const first = p?.navHistory.find(point => point.date >= `${p?.asOf.slice(0,4)}-01-01`);
  const ytdNav = first && p && first.value > 0 ? p.netLiquidation / first.value - 1 : null;
  return <div className="v2-insights-grid"><section className="v2-panel"><div className="panel-heading"><div><span className="eyebrow">ALLOCATION</span><h2>{t("资产分布", "Capital allocation")}</h2></div><span className="subtle">IBKR EOD</span></div><div className="allocation-bar" role="img" aria-label={assets.map(a => `${a.name} ${money(a.value)}`).join(", ")}>{assets.map((a, i) => <span key={a.name} style={{ width: `${totalAbs ? Math.abs(a.value) / totalAbs * 100 : 0}%`, background: ["#5b8cff", "#00b889", "#b69558", "#77818f"][i % 4] }}/>)}</div><div className="allocation-legend">{assets.map((a, i) => <p key={a.name}><i style={{ background: ["#5b8cff", "#00b889", "#b69558", "#77818f"][i % 4] }}/><span>{a.name}</span><b>{money(a.value)}</b></p>)}</div><div className="panel-bottom">{t("条形占比按绝对敞口；金额保留多空符号。", "Bar shares use absolute exposure; signed amounts are retained.")}</div></section><section className="v2-panel"><div className="panel-heading"><div><span className="eyebrow">PERFORMANCE / RISK</span><h2>{t("变化与边界", "Change, with context")}</h2></div></div><dl className="pulse-list"><dt>{t("年内净值变化", "YTD NAV change")}</dt><dd>{percent(ytdNav)}</dd><dt>{t("最大价格变动", "Largest price mover")}</dt><dd>{movers[0] ? `${movers[0].symbol} ${percent(movers[0].change)}` : "—"}</dd><dt>{t("持仓杠杆", "Gross leverage")}</dt><dd>{p ? `${p.leverage.toFixed(2)}×` : "—"}</dd><dt>{t("持仓快照", "Holdings snapshot")}</dt><dd>{p?.asOf ?? "—"}</dd></dl><div className="panel-bottom">{t("净值变化包含出入金影响，不等于投资收益率。价格变动基于行情前收盘。", "NAV change includes cash flows; it is not investment return. Movers compare quotes with previous close.")}</div></section></div>;
}

export function SessionHistory({ data, locale }: { data: LiveDashboard; locale: Locale }) {
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <section className="v2-panel session-history"><div className="panel-heading"><div><span className="eyebrow">SESSION ARCHIVE</span><h2>{t("每一天，成为记录", "Every session becomes a record")}</h2></div><span className="subtle">{data.sessions.length} {t("个交易日", "SESSIONS")}</span></div>{data.sessions.length ? <div className="v2-table-scroll"><table><thead><tr>{[t("交易日", "DATE"), t("首次观测", "FIRST"), t("最后观测", "LAST"), t("观测期盈亏", "OBSERVED P/L"), t("高 / 低", "HIGH / LOW"), t("事件", "EVENTS"), t("状态", "STATE")].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.sessions.map(s => <tr key={s.date}><td>{s.date}</td><td>{money(s.openingNav)}</td><td>{money(s.current)}</td><td>{money(s.current - s.openingNav)}</td><td>{money(s.high)} / {money(s.low)}</td><td>{s.events}</td><td>{s.status}{s.sealedAt && <small>{s.sealedAt.replace("T", " ").slice(0,19)} UTC</small>}</td></tr>)}</tbody></table></div> : <p className="session-empty">{t("还没有完整的行情观测日。首个交易日采样开始后，系统会持久化记录；未完整采集的交易日将标为 INCOMPLETE。", "No observed market sessions yet. Collection creates durable records; a session without adequate closing observations is marked INCOMPLETE.")}</p>}</section>;
}
