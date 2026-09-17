import type { FxQuote } from "./portfolio-data";

export type MoneyView = {
  code: "USD" | "CNY";
  rate: number;
  converted: boolean;
  convert: (value: number) => number;
  format: (value: number) => string;
  signed: (value: number) => string;
};

/** Primary money view is always USD. Locale only affects number formatting. */
export function createMoneyView(locale: "zh" | "en", _fx: FxQuote | null): MoneyView {
  const formatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const convert = (value: number) => value;
  const format = (value: number) => formatter.format(convert(value));
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${format(Math.abs(value))}`;

  return { code: "USD", rate: 1, converted: false, convert, format, signed };
}

/** Secondary CNY label only — never used as primary. Returns null when rate is unusable. */
export function formatCnyApprox(usdValue: number, rate: number | null | undefined, locale: "zh" | "en" = "zh"): string | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(usdValue)) {
    return null;
  }
  const cny = usdValue * rate;
  const amount = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cny);
  return locale === "zh" ? `约 ¥${amount}` : `≈ ¥${amount}`;
}
