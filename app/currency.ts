import type { FxQuote } from "./portfolio-data";

export type MoneyView = {
  code: "USD" | "CNY";
  rate: number;
  converted: boolean;
  convert: (value: number) => number;
  format: (value: number) => string;
  signed: (value: number) => string;
};

export function createMoneyView(locale: "zh" | "en", fx: FxQuote | null): MoneyView {
  const converted = locale === "zh" && fx?.rate !== null && fx?.rate !== undefined && Number.isFinite(fx.rate) && fx.rate > 0;
  const code = converted ? "CNY" : "USD";
  const rate = converted ? fx.rate ?? 1 : 1;
  const formatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const convert = (value: number) => value * rate;
  const format = (value: number) => formatter.format(convert(value));
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${format(Math.abs(value))}`;

  return { code, rate, converted, convert, format, signed };
}
