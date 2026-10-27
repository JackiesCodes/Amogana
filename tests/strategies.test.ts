import { describe, expect, it } from "vitest";

import { STRATEGIES, defaultParams, getStrategy } from "@/lib/strategies";
import { optimise, runBacktest } from "@/lib/strategies/backtest";
import { ema, rsi } from "@/lib/strategies/indicators";
import type { Candle } from "@/lib/strategies/types";

function series(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1]! : close;
    return { epoch: 1_700_000_000 + i * 3600, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close };
  });
}

// Deterministic pseudo-random walk with regime changes.
function walk(n: number, seed = 7): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 300) * 0.0015;
    price *= 1 + drift + rnd() * 0.01;
    closes.push(price);
  }
  return series(closes);
}

const OPTIONS = { initialBalance: 10_000, riskPercent: 1, costPercent: 0.02, timeframe: 3600 };

describe("indicators", () => {
  it("ema seeds with the SMA and then smooths", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3);
  });

  it("rsi is 100 for a series that only rises", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
  });
});

describe("strategies", () => {
  it.each(STRATEGIES.map((s) => [s.id]))("%s never looks ahead", (id) => {
    const def = getStrategy(id)!;
    const candles = walk(800);
    const full = def.positions(candles, defaultParams(def));
    for (const cut of [300, 450, 799]) {
      const partial = def.positions(candles.slice(0, cut), defaultParams(def));
      expect(Array.from(partial)).toEqual(Array.from(full.slice(0, cut)));
    }
  });

  it("trend strategy makes money on a clean uptrend", () => {
    const closes = Array.from({ length: 600 }, (_, i) => 100 + i * 0.2 + Math.sin(i / 5));
    const def = getStrategy("ema_trend")!;
    const result = runBacktest(series(closes), def, defaultParams(def), OPTIONS);
    expect(result.metrics.trades).toBeGreaterThan(0);
    expect(result.metrics.net_profit).toBeGreaterThan(0);
  });

  it("a stopped-out trade loses about the risked amount", () => {
    // The long opens at bar 200 (first bar with a 200 EMA); price collapses right after.
    const closes = [...Array.from({ length: 203 }, (_, i) => 100 + i * 0.1), ...Array.from({ length: 50 }, (_, i) => 120 - i * 2)];
    const def = getStrategy("ema_trend")!;
    const result = runBacktest(series(closes), def, { ...defaultParams(def), rr: 0 }, OPTIONS);
    const stopped = result.trades.filter((t) => t.reason === "stop");
    expect(stopped.length).toBeGreaterThan(0);
    for (const t of stopped) expect(t.r_multiple).toBeLessThan(-0.9);
  });

  it("optimiser ranks strategies by out-of-sample score", () => {
    const board = optimise(walk(3000), OPTIONS);
    expect(board).toHaveLength(STRATEGIES.length);
    for (let i = 1; i < board.length; i++) expect(board[i - 1]!.oos_score).toBeGreaterThanOrEqual(board[i]!.oos_score);
  });
});
