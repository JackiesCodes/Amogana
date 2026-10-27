// Deriv market-data symbols used for candles, backtests and paper pricing.
export const DATA_SYMBOLS = [
  { value: "frxEURUSD", label: "EUR/USD", group: "Forex" },
  { value: "frxGBPUSD", label: "GBP/USD", group: "Forex" },
  { value: "frxUSDJPY", label: "USD/JPY", group: "Forex" },
  { value: "frxAUDUSD", label: "AUD/USD", group: "Forex" },
  { value: "frxUSDCAD", label: "USD/CAD", group: "Forex" },
  { value: "frxXAUUSD", label: "Gold (XAU/USD)", group: "Commodities" },
  { value: "cryBTCUSD", label: "BTC/USD", group: "Crypto" },
  { value: "cryETHUSD", label: "ETH/USD", group: "Crypto" },
  { value: "R_75", label: "Volatility 75 Index", group: "Deriv synthetics" },
  { value: "R_100", label: "Volatility 100 Index", group: "Deriv synthetics" },
  { value: "R_50", label: "Volatility 50 Index", group: "Deriv synthetics" },
  { value: "1HZ100V", label: "Volatility 100 (1s) Index", group: "Deriv synthetics" },
] as const;

export const TIMEFRAMES = [
  { value: 60, label: "M1" },
  { value: 300, label: "M5" },
  { value: 900, label: "M15" },
  { value: 1800, label: "M30" },
  { value: 3600, label: "H1" },
  { value: 14400, label: "H4" },
  { value: 86400, label: "D1" },
] as const;

export function timeframeLabel(seconds: number): string {
  return TIMEFRAMES.find((t) => t.value === seconds)?.label ?? `${seconds}s`;
}

const CRYPTO = ["BTC", "ETH", "LTC", "XRP", "BCH"];

/**
 * Best-effort mapping from a broker symbol to its Deriv data symbol, e.g.
 * Exness "EURUSDm" → "frxEURUSD", "XAUUSDm" → "frxXAUUSD", "BTCUSDm" → "cryBTCUSD".
 */
export function guessDataSymbol(brokerSymbol: string): string {
  const s = brokerSymbol.trim();
  if (/^(frx|cry|R_|1HZ|BOOM|CRASH|JD|stpRNG)/.test(s)) return s;
  const core = s.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  if (core.length < 6) return s;
  return CRYPTO.includes(core.slice(0, 3)) ? `cry${core}` : `frx${core}`;
}

export function symbolLabel(dataSymbol: string): string {
  return DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol;
}
