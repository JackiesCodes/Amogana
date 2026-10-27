import { atr, donchian, ema, rsi } from "@/lib/strategies/indicators";
import type { Candle, StrategyDefinition } from "@/lib/strategies/types";

export type { Candle, StrategyDefinition } from "@/lib/strategies/types";

// Every strategy shares these risk params: stop = atr_mult × ATR(14),
// take-profit = rr × stop (0 = no fixed target, exit on signal only).
const RISK_PARAMS = [
  { key: "atr_mult", label: "Stop (× ATR)", default: 2, grid: [1.5, 2, 3] },
  { key: "rr", label: "Reward : risk", default: 2, grid: [0, 1.5, 2.5] },
];

const emaTrend: StrategyDefinition = {
  id: "ema_trend",
  name: "EMA Trend Rider",
  style: "Trend following",
  description:
    "Goes long when the fast EMA is above the slow EMA and price is above the 200 EMA; short on the mirror image. Rides long trends, loses in choppy ranges.",
  params: [
    { key: "fast", label: "Fast EMA", default: 20, grid: [10, 20, 30] },
    { key: "slow", label: "Slow EMA", default: 50, grid: [50, 100] },
    { key: "allow_short", label: "Allow shorts (1/0)", default: 1, grid: [1] },
    ...RISK_PARAMS,
  ],
  positions(candles, p) {
    const { fast: fastLen = 20, slow: slowLen = 50, allow_short: allowShort = 1 } = p;
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, fastLen);
    const slow = ema(closes, slowLen);
    const trend = ema(closes, 200);
    const out = new Int8Array(candles.length);
    for (let i = 0; i < candles.length; i++) {
      if (Number.isNaN(slow[i]!) || Number.isNaN(trend[i]!)) continue;
      if (fast[i]! > slow[i]! && closes[i]! > trend[i]!) out[i] = 1;
      else if (allowShort && fast[i]! < slow[i]! && closes[i]! < trend[i]!) out[i] = -1;
    }
    return out;
  },
};

const donchianBreakout: StrategyDefinition = {
  id: "donchian_breakout",
  name: "Donchian Breakout",
  style: "Breakout",
  description:
    "Enters when price closes beyond the highest high / lowest low of the last N bars and exits on a break of the shorter exit channel. The classic 'Turtle' approach.",
  params: [
    { key: "entry", label: "Entry channel", default: 20, grid: [20, 40, 55] },
    { key: "exit", label: "Exit channel", default: 10, grid: [10, 20] },
    ...RISK_PARAMS,
  ],
  positions(candles, p) {
    const entry = donchian(candles, p.entry ?? 20);
    const exit = donchian(candles, p.exit ?? 10);
    const out = new Int8Array(candles.length);
    let pos = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!.close;
      if (Number.isNaN(entry.upper[i]!)) continue;
      if (pos === 1 && c < exit.lower[i]!) pos = 0;
      else if (pos === -1 && c > exit.upper[i]!) pos = 0;
      if (c > entry.upper[i]!) pos = 1;
      else if (c < entry.lower[i]!) pos = -1;
      out[i] = pos;
    }
    return out;
  },
};

const rsiPullback: StrategyDefinition = {
  id: "rsi_pullback",
  name: "RSI Pullback",
  style: "Mean reversion in trend",
  description:
    "Buys oversold dips (RSI below the lower band) while price is above the 200 EMA and sells overbought rallies below it, exiting when RSI returns to 50. High win rate, smaller wins.",
  params: [
    { key: "period", label: "RSI period", default: 14, grid: [2, 7, 14] },
    { key: "lower", label: "Oversold", default: 30, grid: [10, 25, 30] },
    ...RISK_PARAMS,
  ],
  positions(candles, p) {
    const { period = 14, lower = 30 } = p;
    const closes = candles.map((c) => c.close);
    const r = rsi(closes, period);
    const trend = ema(closes, 200);
    const upper = 100 - lower;
    const out = new Int8Array(candles.length);
    let pos = 0;
    for (let i = 0; i < candles.length; i++) {
      if (Number.isNaN(r[i]!) || Number.isNaN(trend[i]!)) continue;
      if (pos === 1 && r[i]! > 50) pos = 0;
      if (pos === -1 && r[i]! < 50) pos = 0;
      if (pos === 0 && r[i]! < lower && closes[i]! > trend[i]!) pos = 1;
      else if (pos === 0 && r[i]! > upper && closes[i]! < trend[i]!) pos = -1;
      out[i] = pos;
    }
    return out;
  },
};

export const STRATEGIES: StrategyDefinition[] = [emaTrend, donchianBreakout, rsiPullback];

export function getStrategy(id: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function defaultParams(def: StrategyDefinition): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

export const ATR_PERIOD = 14;

export function atrSeries(candles: Candle[]): number[] {
  return atr(candles, ATR_PERIOD);
}
