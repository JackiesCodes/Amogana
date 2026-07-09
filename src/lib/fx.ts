export interface FxQuote {
  baseCurrency: string;
  quoteCurrency: string;
  midRate: number;
  spreadBps: number;
  effectiveRate: number;
  sourceAmount: number;
  destinationAmount: number;
  spreadCost: number;
}

/**
 * Fallback mid-market rates used only when the `fx_rates` table cannot be
 * reached (e.g. local development without Supabase configured). Production
 * requests should always resolve rates from the database so pricing stays
 * centrally controlled.
 */
const FALLBACK_MID_RATES: Record<string, Record<string, number>> = {
  BWP: { USD: 0.0735, ZAR: 1.3542, EUR: 0.0679, GBP: 0.058, BWP: 1 },
  USD: { BWP: 13.6054, ZAR: 18.421, EUR: 0.9231, GBP: 0.7896, USD: 1 },
  ZAR: { BWP: 0.7385, USD: 0.0543, EUR: 0.0501, GBP: 0.0429, ZAR: 1 },
  EUR: { BWP: 14.728, USD: 1.0833, ZAR: 19.958, GBP: 0.8551, EUR: 1 },
  GBP: { BWP: 17.2414, USD: 1.2665, ZAR: 23.32, EUR: 1.1695, GBP: 1 },
};

export const DEFAULT_SPREAD_BPS = Number(process.env.FX_SPREAD_BPS ?? 75);

export function getFallbackMidRate(base: string, quote: string): number {
  if (base === quote) return 1;
  const rate = FALLBACK_MID_RATES[base]?.[quote];
  if (!rate) {
    throw new Error(`FX_RATE_UNAVAILABLE:${base}->${quote}`);
  }
  return rate;
}

/**
 * Applies the platform spread to a mid-market rate. The spread is expressed
 * in basis points (1 bps = 0.01%) and is subtracted from the rate so the
 * customer always receives slightly less than the true mid-market quote —
 * the difference is Amogana's FX margin.
 */
export function applySpread(midRate: number, spreadBps: number): number {
  return midRate * (1 - spreadBps / 10_000);
}

export function quoteConversion(params: {
  baseCurrency: string;
  quoteCurrency: string;
  sourceAmount: number;
  midRate: number;
  spreadBps?: number;
}): FxQuote {
  const spreadBps = params.spreadBps ?? DEFAULT_SPREAD_BPS;
  const effectiveRate = applySpread(params.midRate, spreadBps);
  const destinationAmount = round4(params.sourceAmount * effectiveRate);
  const spreadCost = round4(params.sourceAmount * (params.midRate - effectiveRate));

  return {
    baseCurrency: params.baseCurrency,
    quoteCurrency: params.quoteCurrency,
    midRate: params.midRate,
    spreadBps,
    effectiveRate,
    sourceAmount: params.sourceAmount,
    destinationAmount,
    spreadCost,
  };
}

export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
