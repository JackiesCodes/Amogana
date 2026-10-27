import type { Candle } from "@/lib/strategies/types";

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j]!;
      prev = sum / period;
    } else if (i >= period) {
      prev = values[i]! * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Wilder's ATR; first value at index `period`. */
export function atr(candles: Candle[], period: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let value = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    if (i <= period) {
      value += tr / period;
      if (i === period) out[i] = value;
    } else {
      value = (value * (period - 1) + tr) / period;
      out[i] = value;
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const g = Math.max(change, 0);
    const l = Math.max(-change, 0);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
      continue;
    }
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Highest high / lowest low of the `period` bars *before* index i (excludes bar i). */
export function donchian(candles: Candle[], period: number): { upper: number[]; lower: number[] } {
  const upper = new Array<number>(candles.length).fill(NaN);
  const lower = new Array<number>(candles.length).fill(NaN);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, candles[j]!.high);
      lo = Math.min(lo, candles[j]!.low);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  return { upper, lower };
}
