"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FxQuote,
  PortfolioApiResponse,
  PortfolioData,
  PortfolioPosition,
  verifiedFallbackPortfolio,
} from "./portfolio-data";
import { portfolioCopy, PortfolioLocale } from "./portfolio-copy";
import { createMoneyView, formatCnyApprox, MoneyView } from "./currency";
import { calculateJourneyMetrics, JourneyMetrics } from "./journey";

type ChartPeriod = "7D" | "1M" | "YTD";
type PnlPeriod = "7D" | "30D" | "90D" | "MTD" | "YTD";
type TimeTheme = "day" | "night";
type SyncView = { kind: "live" | "pending" | "fallback" | "error"; label: string; detail?: string };
type Copy = (typeof portfolioCopy)[PortfolioLocale];

const percent = (value: number, digits = 2) => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(digits)}%`;
const safeRatio = (value: number, base: number) => base ? value / base : 0;
const accentFor = (index: number) => ["blue", "green", "amber", "purple"][index % 4];
const isOption = (assetClass: string) => ["OPT", "FOP"].includes(assetClass.toUpperCase());
const formatJourneyUsd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const formatMilestoneUsd = (value: number) => value >= 1_000_000 ? "$1M" : `$${Math.round(value / 1_000)}K`;
const formatJourneyDate = (value: string, locale: PortfolioLocale) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)).replaceAll("/", ".");
const timeTheme = (date = new Date()): TimeTheme => date.getHours() >= 6 && date.getHours() < 18 ? "day" : "night";
const companyLogos: Record<string, string> = {
  TEM: "/company-logos/tem.png",
  LFMD: "/company-logos/lfmd.png",
};

function TickerLogo({ symbol, index }: { symbol: string; index: number }) {
  const normalizedSymbol = symbol.toUpperCase();
  const logo = companyLogos[normalizedSymbol];
  return (
    <span className={`ticker-avatar avatar-${accentFor(index)} ${logo ? "ticker-avatar-with-logo" : ""}`} aria-hidden="true">
      <span>{normalizedSymbol.slice(0, 1)}</span>
      {logo && <img src={logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
}

function displaySyncTime(value: string, locale: PortfolioLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return locale === "zh" ? formatted.replaceAll("/", "-") : formatted;
}

function displayDataChipTime(value: string, locale: PortfolioLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function displaySource(source: string, locale: PortfolioLocale) {

  if (locale === "zh") {
    return source
      .replace("IBKR connected account history", "IBKR 已连接账户历史")
      .replace("IBKR connected account", "IBKR 已连接账户");
  }
  return source
    .replace("IBKR 已连接账户验证快照", "Verified IBKR connected-account snapshot")
    .replace("IBKR 已连接账户历史", "IBKR connected-account history")
    .replace("IBKR 已连接账户", "IBKR connected account");
}

function chartFor(account: PortfolioData, period: ChartPeriod) {
  const sorted = [...account.navHistory].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  let points = sorted;
  if (period === "7D") points = sorted.slice(-7);
  if (period === "1M" && latest) {
    const threshold = new Date(`${latest.date}T00:00:00Z`);
    threshold.setUTCDate(threshold.getUTCDate() - 31);
    points = sorted.filter((point) => point.date >= threshold.toISOString().slice(0, 10));
  }
  if (period === "YTD" && latest) points = sorted.filter((point) => point.date.startsWith(latest.date.slice(0, 4)));
  if (points.length < 2) points = [
    { date: account.asOf, value: account.previousNav || account.netLiquidation },
    { date: account.asOf, value: account.netLiquidation },
  ];
  const first = points[0]?.value || account.netLiquidation;
  const last = points.at(-1)?.value || account.netLiquidation;
  return {
    dates: points.map((point) => point.date.slice(5).replace("-", "/")),
    values: points.map((point) => point.value),
    change: first ? last / first - 1 : 0,
  };
}

function ToneValue({ value, money, kind = "money" }: { value: number; money: MoneyView; kind?: "money" | "percent" }) {
  return <span className={value >= 0 ? "positive" : "negative"}>{kind === "money" ? money.signed(value) : percent(value)}</span>;
}

function MetricCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong className={tone === "neutral" ? "" : tone}>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function LanguageSwitch({ locale, copy }: { locale: PortfolioLocale; copy: Copy }) {
  return (
    <nav className="language-switch" aria-label={copy.languageLabel}>
      <Link href="/" className={locale === "zh" ? "active" : ""} aria-current={locale === "zh" ? "page" : undefined}>{copy.languageZh}</Link>
      <span aria-hidden="true">/</span>
      <Link href="/en" className={locale === "en" ? "active" : ""} aria-current={locale === "en" ? "page" : undefined}>{copy.languageEn}</Link>
    </nav>
  );
}

function NavChart({ account, period, copy, money }: { account: PortfolioData; period: ChartPeriod; copy: Copy; money: MoneyView }) {
  const data = chartFor(account, period);
  const chart = useMemo(() => {
    const width = 760;
    const height = 286;
    const padX = 38;
    const padTop = 24;
    const padBottom = 38;
    const minRaw = Math.min(...data.values);
    const maxRaw = Math.max(...data.values);
    const buffer = Math.max((maxRaw - minRaw) * 0.14, 20);
    const min = minRaw - buffer;
    const max = maxRaw + buffer;
    const points = data.values.map((value, index) => ({
      x: padX + (index / Math.max(data.values.length - 1, 1)) * (width - padX * 2),
      y: padTop + ((max - value) / (max - min)) * (height - padTop - padBottom),
      value,
    }));
    return {
      width,
      height,
      points,
      line: points.map((point) => `${point.x},${point.y}`).join(" "),
      ticks: [maxRaw, (maxRaw + minRaw) / 2, minRaw],
    };
  }, [data.values]);

  return (
    <div className="nav-chart">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${period} ${copy.sections.trend}`}>
        {[56, 143, 230].map((y, index) => (
          <g key={y}>
            <line x1="38" x2="722" y1={y} y2={y} className="chart-grid-line" />
            <text x="0" y={y + 4} className="axis-label">{money.format(chart.ticks[index])}</text>
          </g>
        ))}
        <polyline points={chart.line} className="nav-line" />
        {chart.points.map((point, index) => (
          <circle key={`${period}-${index}`} cx={point.x} cy={point.y} r={index === chart.points.length - 1 ? 5 : 3.5} className="nav-point" />
        ))}
      </svg>
      <div className="chart-dates" aria-hidden="true">
        {data.dates.map((date, index) => <span key={`${date}-${index}`}>{date}</span>)}
      </div>
    </div>
  );
}

function AllocationPanel({ account, copy, money }: { account: PortfolioData; copy: Copy; money: MoneyView }) {
  const positions = [...account.positions].sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  const cashWeight = safeRatio(account.totalCash, account.netLiquidation) * 100;
  const palette = ["#2d6fd2", "#2aa570", "#bc7416", "#7654d6", "#1792a8"];
  const allocation = positions.reduce<{ running: number; stops: string[] }>((result, position, index) => {
    const next = result.running + Math.max(0, safeRatio(Math.abs(position.marketValue), account.netLiquidation) * 100);
    return {
      running: next,
      stops: [...result.stops, `${palette[index % palette.length]} ${result.running}% ${Math.min(next, 100)}%`],
    };
  }, { running: 0, stops: [] });
  const running = allocation.running;
  const stops = [...allocation.stops];
  if (running < 100) stops.push(`#bcc3cc ${running}% 100%`);
  const donutStyle = { background: `conic-gradient(${stops.join(", ")})` } as CSSProperties;

  return (
    <article className="panel allocation-card">
      <div className="section-heading">
        <div><span>02</span><h2>{copy.sections.allocation}</h2></div>
        <small>{copy.sections.allocationNote}</small>
      </div>
      <div className="allocation-content">
        <div className="allocation-donut" style={donutStyle} aria-label={copy.allocationAria}>
          <div><strong>{money.format(account.netLiquidation)}</strong><span>{copy.sections.netAsset}</span></div>
        </div>
        <div className="allocation-legend">
          {positions.map((position, index) => (
            <div className="legend-row" key={position.contractKey}>
              <span className="legend-swatch" style={{ background: palette[index % palette.length] }} />
              <strong>{position.symbol}</strong>
              <span>{money.format(position.marketValue)}</span>
              <em>{(safeRatio(Math.abs(position.marketValue), account.netLiquidation) * 100).toFixed(1)}%</em>
            </div>
          ))}
          <div className="legend-row">
            <span className="legend-swatch swatch-cash" />
            <strong>{copy.metrics.cash}</strong>
            <span>{money.format(account.totalCash)}</span>
            <em>{cashWeight.toFixed(2)}%</em>
          </div>
        </div>
      </div>
      <div className="allocation-foot"><span>{copy.sections.totalPositionRatio}</span><strong>{(safeRatio(account.grossPositionValue, account.netLiquidation) * 100).toFixed(2)}%</strong></div>
    </article>
  );
}

function PnlSummary({ account, period, onChange, copy, money }: { account: PortfolioData; period: PnlPeriod; onChange: (period: PnlPeriod) => void; copy: Copy; money: MoneyView }) {
  const realized = period === "YTD" ? account.realizedYtd : 0;
  const optionUnrealized = account.positions.filter((position) => isOption(position.assetClass)).reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const stockUnrealized = account.unrealizedPnl - optionUnrealized;
  const realizedStock = optionUnrealized === 0 ? realized : 0;
  return (
    <section className="section-block">
      <div className="section-title-row">
        <div>
          <span className="section-kicker">06</span>
          <h2>{copy.sections.pnl}</h2>
          <p>{copy.sections.pnlNote}</p>
        </div>
        <div className="segmented-control" aria-label={copy.sections.pnlPeriodAria}>
          {(["7D", "30D", "90D", "MTD", "YTD"] as PnlPeriod[]).map((key) => (
            <button key={key} className={period === key ? "active" : ""} onClick={() => onChange(key)} aria-pressed={period === key}>{key}</button>
          ))}
        </div>
      </div>
      <article className="panel pnl-table-wrap">
        <table className="data-table pnl-table">
          <thead><tr><th>{copy.sections.category}</th><th>{copy.sections.realized(period)}</th><th>{copy.sections.unrealized}</th><th>{copy.sections.total}</th></tr></thead>
          <tbody>
            <tr><td><span className="asset-badge stock-badge">{copy.table.stock}</span></td><td><ToneValue value={realizedStock} money={money} /></td><td><ToneValue value={stockUnrealized} money={money} /></td><td><ToneValue value={realizedStock + stockUnrealized} money={money} /></td></tr>
            <tr><td><span className="asset-badge option-badge">{copy.table.option}</span></td><td>{money.format(0)}</td><td><ToneValue value={optionUnrealized} money={money} /></td><td><ToneValue value={optionUnrealized} money={money} /></td></tr>
            <tr className="total-row"><td>{copy.sections.total}</td><td><ToneValue value={realized} money={money} /></td><td><ToneValue value={account.unrealizedPnl} money={money} /></td><td><ToneValue value={realized + account.unrealizedPnl} money={money} /></td></tr>
          </tbody>
        </table>
        <p className="table-note">{copy.sections.realizedYtd(money.signed(account.realizedYtd))}</p>
      </article>
    </section>
  );
}

function JourneyBullMarker({ completed }: { completed: boolean }) {
  const [staticAssetReady, setStaticAssetReady] = useState(true);
  const [runAssetReady, setRunAssetReady] = useState(false);
  if (!staticAssetReady && !runAssetReady) return null;

  return (
    <>
      <span className={`bull-ambition-trail${completed ? " bull-ambition-trail-complete" : ""}`} aria-hidden="true" />
      <span
        className={`journey-bull${completed ? " journey-bull-complete" : ""}`}
        data-run-ready={runAssetReady ? "true" : "false"}
        aria-hidden="true"
      >
        {staticAssetReady ? <img
          className="journey-bull-static"
          src="/journey-bull-v1.webp"
          alt=""
          width="768"
          height="517"
          draggable="false"
          onError={() => setStaticAssetReady(false)}
        /> : null}
        <span className="journey-bull-run-window">
          <span className="journey-bull-run-sprite" />
          <span className="bull-hoof-dust bull-hoof-dust-a" />
          <span className="bull-hoof-dust bull-hoof-dust-b" />
        </span>
        <img
          className="journey-bull-run-preload"
          src="/journey-bull-run-v2.webp"
          alt=""
          width="2176"
          height="360"
          draggable="false"
          onLoad={() => setRunAssetReady(true)}
          onError={() => setRunAssetReady(false)}
        />
      </span>
      <span className={`journey-target-flare${completed ? " journey-target-flare-complete" : ""}`} aria-hidden="true" />
    </>
  );
}

function JourneyHero({ account, journey, locale, copy, money, fx }: { account: PortfolioData; journey: JourneyMetrics; locale: PortfolioLocale; copy: Copy; money: MoneyView; fx: FxQuote | null }) {
  const underwater = journey.currentValue < 10_000;
  const remainingLabel = journey.remainingToStart > 0
    ? copy.journey.remainingToStart(formatJourneyUsd(journey.remainingToStart))
    : copy.journey.remainingToTarget(formatJourneyUsd(journey.remainingToTarget));
  const cnyApprox = formatCnyApprox(journey.currentValue, fx?.rate ?? null, locale);
  // Underwater: break-even ruler only — do not drive the bar with journey.progress (stays 0% below $10K).
  const rulerProgress = underwater ? 0 : journey.progress * 100;
  return (
    <section className="journey-hero" aria-labelledby="journey-title">
      <div className="journey-hero-heading">
        <div>
          <span className="journey-sequence">INVESTMENT JOURNEY · 001</span>
          <h1 id="journey-title">{copy.title}</h1>
          <p className="journey-alternate-title">{copy.journey.alternateTitle}</p>
          <p className="journey-weekly-pulse">{copy.journey.weeklyPulse}</p>
        </div>
        <div className="journey-manifesto"><strong>{copy.journey.route}</strong><span>{copy.journey.motto}</span></div>
      </div>

      <div className="journey-route" data-phase={underwater ? "underwater" : "journey"} style={{ "--journey-progress": `${rulerProgress}%` } as CSSProperties}>
        <div className="journey-route-values">
          <div><span>START</span><strong>$10,000</strong></div>
          <div className={`journey-current-value${underwater ? " underwater" : ""}`}>
            <span>CURRENT</span>
            <strong>{formatJourneyUsd(journey.currentValue)}</strong>
            {cnyApprox ? <small className="current-cny-approx">{cnyApprox}</small> : null}
          </div>
          <div><span>TARGET</span><strong>$1,000,000</strong></div>
        </div>
        <div className="journey-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(rulerProgress.toFixed(2))} aria-label={remainingLabel}>
          <span className="journey-progress-rail">
            <span className="journey-progress-fill" />
            <span className="journey-progress-marker" />
            <JourneyBullMarker key={rulerProgress.toFixed(4)} completed={!underwater && journey.progress >= 1} />
          </span>
        </div>
        <div className="journey-progress-labels"><span>$10K</span><span>{remainingLabel}</span><span>$1M</span></div>
      </div>

      <div className="journey-kpis">
        <article>
          <span>{copy.journey.currentPortfolio}</span>
          <strong>{formatJourneyUsd(journey.currentValue)}</strong>
          <small>{cnyApprox ?? `${account.asOf} · USD`}</small>
        </article>
        <article>
          <span>{copy.journey.totalReturn}</span>
          <strong className={journey.totalReturn >= 0 ? "positive" : "negative"}>{percent(journey.totalReturn, 1)}</strong>
          <small>{copy.journey.usdBasis}</small>
        </article>
      </div>
    </section>
  );
}

function MilestoneRoadmap({ journey, locale, copy }: { journey: JourneyMetrics; locale: PortfolioLocale; copy: Copy }) {
  return (
    <section className="milestone-section" aria-labelledby="milestone-heading">
      <div className="milestone-heading">
        <div><span>ROADMAP</span><h2 id="milestone-heading">{copy.journey.milestones}</h2></div>
        <p>{copy.journey.milestonesNote}</p>
      </div>
      <div className="milestone-grid">
        {journey.milestones.map((milestone, index) => (
          <article className={`milestone-card milestone-${milestone.status}`} key={milestone.value}>
            <div><span>{copy.journey.milestone(index + 1)}</span><em>{milestone.status === "achieved" ? copy.journey.achieved : milestone.status === "next" ? copy.journey.next : copy.journey.locked}</em></div>
            <strong>{formatMilestoneUsd(milestone.value)}</strong>
            <time dateTime={milestone.reachedAt ?? undefined}>{milestone.reachedAt ? formatJourneyDate(milestone.reachedAt, locale) : "—"}</time>
            <small>{milestone.daysFromJourneyStart !== null ? copy.journey.recordedSince(milestone.daysFromJourneyStart) : copy.journey.noRecordedDate}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function PositionRows({ positions, account, copy, money }: { positions: PortfolioPosition[]; account: PortfolioData; copy: Copy; money: MoneyView }) {
  return positions.map((position, index) => (
    <tr key={position.contractKey}>
      <td><div className="ticker-cell"><TickerLogo symbol={position.symbol} index={index} /><div><strong>{position.symbol}</strong><small>{position.name}</small></div></div></td>
      <td><span className={`asset-badge ${isOption(position.assetClass) ? "option-badge" : "stock-badge"}`}>{isOption(position.assetClass) ? copy.table.option : copy.table.stock}</span></td>
      <td>{position.quantity.toLocaleString("en-US")}</td>
      <td>{money.format(position.price)}</td>
      <td>{money.format(position.averagePrice)}</td>
      <td><strong>{money.format(position.marketValue)}</strong><small>{(safeRatio(Math.abs(position.marketValue), account.netLiquidation) * 100).toFixed(1)}%</small></td>
      <td><ToneValue value={position.dailyPnl} money={money} /></td>
      <td><ToneValue value={position.unrealizedPnl} money={money} /></td>
    </tr>
  ));
}

export default function PortfolioDashboard({ locale }: { locale: PortfolioLocale }) {
  const copy = portfolioCopy[locale];
  const [account, setAccount] = useState<PortfolioData>(verifiedFallbackPortfolio);
  const [fx, setFx] = useState<FxQuote | null>(null);
  const [syncView, setSyncView] = useState<SyncView>({ kind: "fallback", label: copy.sync.initial });
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("7D");
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>("90D");
  const [theme, setTheme] = useState<TimeTheme>("night");

  useEffect(() => {
    const syncTheme = () => setTheme(timeTheme());
    syncTheme();
    const timer = window.setInterval(syncTheme, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const portfolioUrl = "/api/portfolio";
    fetch(portfolioUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Portfolio API unavailable");
        return response.json() as Promise<PortfolioApiResponse>;
      })
      .then((data) => {
        setFx(data.fx ?? null);
        if (data.portfolio) {
          setAccount(data.portfolio);
          if (!data.configured) {
            setSyncView({ kind: "fallback", label: copy.sync.waiting });
          } else if (data.lastRun?.status === "failed") {
            setSyncView({ kind: "error", label: copy.sync.failed, detail: data.lastRun.error ?? undefined });
          } else {
            setSyncView({ kind: "live", label: copy.sync.automatic });
          }
        } else if (data.configured) {
          setSyncView({ kind: "pending", label: copy.sync.pending });
        } else {
          setSyncView({ kind: "fallback", label: copy.sync.waiting });
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (locale === "zh") {
          setFx({ pair: "USD/CNY", rate: null, quotedAt: null, fetchedAt: null, source: "Twelve Data", status: "unavailable" });
        }
        setSyncView({ kind: "fallback", label: copy.sync.fallback });
      });
    return () => controller.abort();
  }, [copy, locale]);

  const chartData = chartFor(account, chartPeriod);
  const money = useMemo(() => createMoneyView(locale, fx), [locale, fx]);
  const sortedPositions = [...account.positions].sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  const stockPositions = sortedPositions.filter((position) => !isOption(position.assetClass));
  const optionPositions = sortedPositions.filter((position) => isOption(position.assetClass));
  const largest = sortedPositions[0];
  const largestWeight = largest ? safeRatio(Math.abs(largest.marketValue), account.netLiquidation) : 0;
  const cashRatio = safeRatio(account.totalCash, account.netLiquidation);
  const healthcareOnly = sortedPositions.length > 0 && sortedPositions.every((position) => ["TEM", "LFMD"].includes(position.symbol));
  const journey = calculateJourneyMetrics(account.netLiquidation, account.navHistory, account.asOf);

  return (
    <main className={`journey-dashboard theme-${theme}`} lang={copy.htmlLang} data-time-theme={theme}>
      <div className="page-shell">
        <header className="journey-header">
          <div className="journey-identity">
            <div className="owner-avatar-wrap">
              <img className="owner-avatar" src="/ding-xiaoshan-avatar.png" alt={copy.ownerAvatarAlt} width="96" height="96" />
              <span className="owner-online" aria-hidden="true" />
            </div>
            <div className="journey-identity-copy">
              <div className="product-mark"><span>IB</span> {copy.productLabel}</div>
              <strong>{copy.subtitle}</strong>
              <div className="header-chip-row" aria-label={copy.latestRefresh}>
                <span className="data-chip"><span>{copy.sync.dataChip}</span><strong>· {displayDataChipTime(account.updatedAt, locale)}</strong></span>
                {(syncView.kind === "fallback" || syncView.kind === "pending" || syncView.kind === "error") ? (
                  <button type="button" className={`sync-chip sync-chip-cta sync-${syncView.kind}`} title={syncView.detail ?? copy.sync.authorizeCta}>
                    {syncView.kind === "error" ? syncView.label : copy.sync.authorizeCta}
                  </button>
                ) : (
                  <span className={`sync-chip sync-${syncView.kind}`} title={syncView.detail}>{syncView.label}</span>
                )}
              </div>
            </div>
          </div>
          <Link className="journey-key-link" href="/jade-key" aria-label={copy.keyLogoLabel} title={copy.keyLogoLabel}>
            <img src="/cloud-jade-key-mark-v3.webp" alt={copy.keyLogoAlt} width="1279" height="452" />
          </Link>
          <div className="site-header-actions">
            <LanguageSwitch locale={locale} copy={copy} />
          </div>
        </header>

        <JourneyHero account={account} journey={journey} locale={locale} copy={copy} money={money} fx={fx} />
        <MilestoneRoadmap journey={journey} locale={locale} copy={copy} />

        {locale === "zh" && (
          <div className={`fx-quote journey-fx fx-${fx?.status ?? "loading"}`} aria-live="polite">
            <span className="fx-label">{copy.fx.label}</span>
            {fx?.rate ? (
              <><strong>{copy.fx.rate(fx.rate.toFixed(4))}</strong><span className="fx-state">{fx.status === "stale" ? copy.fx.stale : copy.fx.live}</span><small>{fx.quotedAt ? copy.fx.quotedAt(displaySyncTime(fx.quotedAt, locale)) : fx.source}</small></>
            ) : (
              <strong>{fx?.status === "unavailable" ? copy.fx.unavailable : copy.fx.loading}</strong>
            )}
          </div>
        )}

        <section className="metrics terminal-metrics" aria-label={copy.summaryAria}>
          <MetricCard label={copy.metrics.ytdReturn} value={percent(account.ytdReturn)} note={`${copy.closeData} · ${account.asOf}`} tone={account.ytdReturn >= 0 ? "positive" : "negative"} />
          <MetricCard label={copy.metrics.weekReturn} value={percent(account.weekReturn)} note={copy.risks.closeSnapshot} tone={account.weekReturn >= 0 ? "positive" : "negative"} />
          <MetricCard label={copy.metrics.dailyPnl} value={money.signed(account.dailyPnl)} note={copy.metrics.currentPositions(percent(account.dailyReturn))} tone={account.dailyPnl >= 0 ? "positive" : "negative"} />
          <MetricCard label={copy.metrics.cash} value={money.format(account.totalCash)} note={copy.metrics.cashShare(`${(cashRatio * 100).toFixed(3)}%`)} />
          <MetricCard label={copy.metrics.leverage} value={`${account.leverage.toFixed(2)}x`} note={largest ? copy.metrics.largestPosition(largest.symbol, `${(largestWeight * 100).toFixed(1)}%`) : copy.metrics.noPositions} />
        </section>

        <section className="overview-grid">
          <article className="panel trend-card">
            <div className="section-heading">
              <div><span>01</span><h2>{copy.sections.trend}</h2></div>
              <div className="trend-heading-right">
                <strong className={chartData.change >= 0 ? "positive" : "negative"}>{percent(chartData.change)}</strong>
                <div className="segmented-control compact" aria-label={copy.sections.trendAria}>
                  {(["7D", "1M", "YTD"] as ChartPeriod[]).map((key) => (
                    <button key={key} className={chartPeriod === key ? "active" : ""} onClick={() => setChartPeriod(key)} aria-pressed={chartPeriod === key}>{key}</button>
                  ))}
                </div>
              </div>
            </div>
            <NavChart account={account} period={chartPeriod} copy={copy} money={money} />
            <div className="trend-foot"><span>{copy.sections.periodStart} {money.format(chartData.values[0])}</span><span>{copy.sections.latest} {money.format(account.netLiquidation)}</span></div>
          </article>
          <AllocationPanel account={account} copy={copy} money={money} />
        </section>

        <section className="section-block">
          <div className="section-title-row">
            <div><span className="section-kicker">04</span><h2>{copy.sections.holdings}</h2><p>{copy.sections.holdingsNote}</p></div>
          </div>
          <article className="panel table-panel">
            <div className="table-scroll">
              <table className="data-table positions-table">
                <thead><tr><th>{copy.table.ticker}</th><th>{copy.table.assetType}</th><th>{copy.table.quantity}</th><th>{copy.table.currentPrice}</th><th>{copy.table.averageCost}</th><th>{copy.table.valueWeight}</th><th>{copy.table.dailyPnl}</th><th>{copy.table.unrealizedPnl}</th></tr></thead>
                <tbody><PositionRows positions={stockPositions} account={account} copy={copy} money={money} /></tbody>
              </table>
            </div>
          </article>
        </section>

        <section className="risk-strip" aria-label={copy.risks.aria}>
          <article><span>{copy.risks.concentration}</span><strong className={largestWeight > 0.5 ? "negative" : ""}>{largest ? `${largest.symbol} ${(largestWeight * 100).toFixed(1)}%` : copy.metrics.noPositions}</strong><small>{largestWeight > 0.5 ? copy.risks.highConcentration : copy.risks.controlledConcentration}</small></article>
          <article><span>{copy.risks.exposure}</span><strong>{healthcareOnly ? copy.risks.healthcare : copy.risks.diversified}</strong><small>{healthcareOnly ? copy.risks.healthcareNote : copy.risks.diversifiedNote}</small></article>
          <article><span>{copy.risks.cashBuffer}</span><strong className={cashRatio < 0.05 ? "negative" : ""}>{(cashRatio * 100).toFixed(3)}%</strong><small>{cashRatio < 0.05 ? copy.risks.lowCash : copy.risks.cashAvailable}</small></article>
          <article><span>{copy.risks.lastSevenDays}</span><strong className={account.weekReturn >= 0 ? "positive" : "negative"}>{percent(account.weekReturn)}</strong><small>{copy.risks.closeSnapshot}</small></article>
        </section>

        <section className="section-block option-section">
          <div className="section-title-row">
            <div><span className="section-kicker">05</span><h2>{copy.sections.options}</h2><p>{copy.sections.optionsNote}</p></div>
            <span className="empty-count">{copy.sections.contracts(optionPositions.length)}</span>
          </div>
          {optionPositions.length ? (
            <article className="panel table-panel">
              <div className="table-scroll">
                <table className="data-table positions-table">
                  <thead><tr><th>{copy.table.contract}</th><th>{copy.table.assetType}</th><th>{copy.table.quantity}</th><th>{copy.table.currentPrice}</th><th>{copy.table.averageCost}</th><th>{copy.table.valueWeight}</th><th>{copy.table.dailyPnl}</th><th>{copy.table.unrealizedPnl}</th></tr></thead>
                  <tbody><PositionRows positions={optionPositions} account={account} copy={copy} money={money} /></tbody>
                </table>
              </div>
            </article>
          ) : (
            <article className="panel empty-state">
              <div className="empty-symbol">∅</div>
              <div><strong>{copy.sections.noOptions}</strong><p>{copy.sections.noOptionsNote}</p></div>
            </article>
          )}
        </section>

        <PnlSummary account={account} period={pnlPeriod} onChange={setPnlPeriod} copy={copy} money={money} />

        <section className="section-block contact-section" aria-labelledby="contact-heading">
          <div className="section-title-row">
            <div><span className="section-kicker">07</span><h2 id="contact-heading">{copy.sections.contact}</h2><p>{copy.sections.contactNote}</p></div>
          </div>
          <div className="contact-grid">
            <article className="panel contact-card"><strong>{locale === "zh" ? "中国" : "China"}</strong><a href="tel:+8619951677665"><span>{copy.table.phone}</span>+86 199 5167 7665</a><a href="mailto:people@china.com"><span>{copy.table.email}</span>people@china.com</a></article>
            <article className="panel contact-card"><strong>{locale === "zh" ? "美国" : "United States"}</strong><a href="tel:+19809990101"><span>{copy.table.phone}</span>+1 980 999 0101</a><a href="mailto:0288882@gmail.com"><span>{copy.table.email}</span>0288882@gmail.com</a></article>
            <article className="panel contact-card social-card">
              <div className="radio-contact-copy">
                <strong>{locale === "zh" ? "X / 业余无线电" : "X / Amateur Radio"}</strong>
                <a href="https://x.com/languagemodelAI" target="_blank" rel="noreferrer"><span>{locale === "zh" ? "账号" : "Account"}</span>@languagemodelAI</a>
                <p><span>{copy.table.callSign}</span>BD4WUC</p>
              </div>
              <img className="amateur-radio-logo" src="/bd4wuc-amateur-radio-logo.webp" alt={locale === "zh" ? "BD4WUC 业余无线电标识" : "BD4WUC amateur radio logo"} width="400" height="400" />
            </article>
          </div>
        </section>

        <footer>
          <p>{copy.footer.source(displaySource(account.source, locale))}</p>
          <p>{copy.footer.schedule}</p>
        </footer>
      </div>
    </main>
  );
}
