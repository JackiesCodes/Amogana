import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Currency symbols are rendered manually against a single fixed locale
// ("en-US") for the numeric portion. Letting `Intl.NumberFormat` resolve
// both the symbol *and* grouping/decimal separators per-currency locale
// (e.g. "en-ZA", "de-DE") produces different output between Node's ICU
// data and the browser's, which causes React hydration mismatches.
const CURRENCY_SYMBOL: Record<string, string> = {
  BWP: "P",
  ZAR: "R",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function formatCurrency(amount: number, currencyCode: string): string {
  const symbol = CURRENCY_SYMBOL[currencyCode] ?? `${currencyCode} `;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${symbol} ${formatted}`;
}

export function formatCompactNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function truncateAddress(value: string, visible = 6): string {
  if (value.length <= visible * 2) return value;
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}
