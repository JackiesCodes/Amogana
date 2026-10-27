import { atrSeries, getStrategy, STRATEGIES } from "@/lib/strategies";
import type { Candle, StrategyDefinition } from "@/lib/strategies/types";

export interface BacktestOptions {
  initialBalance: number;
  riskPercent: number;
  /** Round-trip trading cost (spread + commission) as % of price, e.g. 0.02. */
  costPercent: number;
  /** Seconds per candle — only used to annualise the Sharpe ratio. */
  timeframe: number;
  /** Only open trades on bars in [fromIndex, toIndex). Indicators still use earlier bars. */
  fromIndex?: number;
  toIndex?: number;
}

export interface BacktestTrade {
  side: "buy" | "sell";
  entry_epoch: number;
  exit_epoch: number;
  entry: number;
  exit: number;
  pnl: number;
  r_multiple: number;
  reason: "signal" | "stop" | "target" | "end";
}

export interface BacktestMetrics {
  net_profit: number;
  return_percent: number;
  max_drawdown_percent: number;
  trades: number;
  win_rate: number;
  /** null when there were no losing trades. */
  profit_factor: number | null;
  avg_r: number;
  sharpe: number;
  buy_hold_percent: number;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equity: Array<{ epoch: number; equity: number }>;
}

interface OpenPosition {
  dir: 1 | -1;
  entry: number;
  stop: number;
  target: number | null;
  units: number;
  risk: number;
  entryEpoch: number;
}

/**
 * Bar-by-bar simulation shared by the Strategy Lab and the live bot runner's
 * logic: a position opens at the next bar's open when the strategy's desired
 * position *changes* (edge-triggered), and closes when the desired position
 * no longer matches, or intrabar on stop / target (stop checked first —
 * the pessimistic assumption when both are touched in one bar).
 */
export function runBacktest(
  candles: Candle[],
  strategy: StrategyDefinition,
  params: Record<string, number>,
  options: BacktestOptions,
): BacktestResult {
  const from = Math.max(options.fromIndex ?? 1, 2);
  const to = Math.min(options.toIndex ?? candles.length, candles.length);
  const desired = strategy.positions(candles, params);
  const atr = atrSeries(candles);
  const atrMult = params.atr_mult ?? 2;
  const rr = params.rr ?? 0;

  let balance = options.initialBalance;
  let pos: OpenPosition | null = null;
  const trades: BacktestTrade[] = [];
  const equity: Array<{ epoch: number; equity: number }> = [];

  const close = (exit: number, epoch: number, reason: BacktestTrade["reason"]) => {
    const p = pos!;
    const gross = (exit - p.entry) * p.dir * p.units;
    const cost = (p.units * p.entry * options.costPercent) / 100;
    const pnl = gross - cost;
    balance += pnl;
    trades.push({
      side: p.dir === 1 ? "buy" : "sell",
      entry_epoch: p.entryEpoch,
      exit_epoch: epoch,
      entry: p.entry,
      exit,
      pnl,
      r_multiple: p.risk > 0 ? pnl / p.risk : 0,
      reason,
    });
    pos = null;
  };

  for (let i = from; i < to; i++) {
    const bar = candles[i]!;
    const want = desired[i - 1]!;

    if (pos && want !== pos.dir) close(bar.open, bar.epoch, "signal");

    if (!pos && want !== 0 && want !== desired[i - 2]!) {
      const stopDist = atr[i - 1]! * atrMult;
      if (Number.isFinite(stopDist) && stopDist > 0 && balance > 0) {
        const risk = (balance * options.riskPercent) / 100;
        const dir = want as 1 | -1;
        pos = {
          dir,
          entry: bar.open,
          stop: bar.open - dir * stopDist,
          target: rr > 0 ? bar.open + dir * rr * stopDist : null,
          units: risk / stopDist,
          risk,
          entryEpoch: bar.epoch,
        };
      }
    }

    if (pos) {
      const p: OpenPosition = pos;
      const stopHit = p.dir === 1 ? bar.low <= p.stop : bar.high >= p.stop;
      const targetHit = p.target !== null && (p.dir === 1 ? bar.high >= p.target : bar.low <= p.target);
      if (stopHit) close(p.stop, bar.epoch, "stop");
      else if (targetHit) close(p.target!, bar.epoch, "target");
    }

    const floating = pos ? (bar.close - pos.entry) * pos.dir * pos.units : 0;
    equity.push({ epoch: bar.epoch, equity: balance + floating });
  }

  if (pos && to > from) close(candles[to - 1]!.close, candles[to - 1]!.epoch, "end");
  if (equity.length) equity[equity.length - 1]!.equity = balance;

  return {
    metrics: computeMetrics(trades, equity, options, candles[from - 1]!?.close, candles[to - 1]!?.close),
    trades,
    equity: downsample(equity, 300),
  };
}

function computeMetrics(
  trades: BacktestTrade[],
  equity: Array<{ equity: number }>,
  options: BacktestOptions,
  firstPrice: number | undefined,
  lastPrice: number | undefined,
): BacktestMetrics {
  const start = options.initialBalance;
  const end = equity.length ? equity[equity.length - 1]!.equity : start;

  let peak = start;
  let maxDd = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - point.equity) / peak : 0);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);

  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1]!.equity > 0) returns.push(equity[i]!.equity / equity[i - 1]!.equity - 1);
  }
  const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length || 1);
  const barsPerYear = (365 * 86400) / options.timeframe;
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(barsPerYear) : 0;

  return {
    net_profit: end - start,
    return_percent: ((end - start) / start) * 100,
    max_drawdown_percent: maxDd * 100,
    trades: trades.length,
    win_rate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    avg_r: trades.length ? trades.reduce((s, t) => s + t.r_multiple, 0) / trades.length : 0,
    sharpe,
    buy_hold_percent: firstPrice && lastPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0,
  };
}

function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]!);
  out.push(points[points.length - 1]!);
  return out;
}

// ---------------------------------------------------------------------------
// Optimiser with walk-forward validation

const MIN_TRADES = 8;

/** Return per unit of drawdown; strategies with too few trades are not trusted. */
export function score(m: BacktestMetrics): number {
  if (m.trades < MIN_TRADES) return -Infinity;
  return m.return_percent / Math.max(m.max_drawdown_percent, 2);
}

function* grid(def: StrategyDefinition): Generator<Record<string, number>> {
  const specs = def.params;
  const idx: number[] = specs.map(() => 0);
  while (true) {
    yield Object.fromEntries(specs.map((s, k) => [s.key, s.grid[idx[k]!]!]));
    let k = 0;
    for (; k < specs.length; k++) {
      idx[k] = idx[k]! + 1;
      if (idx[k]! < specs[k]!.grid.length) break;
      idx[k] = 0;
    }
    if (k === specs.length) return;
  }
}

export interface OptimiseEntry {
  strategy_id: string;
  strategy_name: string;
  params: Record<string, number>;
  in_sample: BacktestMetrics;
  out_of_sample: BacktestMetrics;
  /** -Infinity (null over JSON) when there were too few trades to judge. */
  oos_score: number;
  combos_tested: number;
  /** Out-of-sample equity curve, for the chart. */
  equity: Array<{ epoch: number; equity: number }>;
}

/**
 * For each strategy: try every parameter combination on the first
 * `trainFraction` of the data ("training"), keep the 3 best, then judge
 * them only on the remaining unseen data. The leaderboard is ranked by that
 * unseen-data score, which is a far better guide to live behaviour than the
 * training score — but still no guarantee.
 */
export function optimise(
  candles: Candle[],
  options: Omit<BacktestOptions, "fromIndex" | "toIndex">,
  strategyIds?: string[],
  trainFraction = 0.7,
): OptimiseEntry[] {
  const split = Math.floor(candles.length * trainFraction);
  const defs = strategyIds?.length ? strategyIds.map((id) => getStrategy(id)!).filter(Boolean) : STRATEGIES;
  const results: OptimiseEntry[] = [];

  for (const def of defs) {
    const ranked: Array<{ params: Record<string, number>; metrics: BacktestMetrics; s: number }> = [];
    let combos = 0;
    for (const params of grid(def)) {
      combos++;
      const r = runBacktest(candles, def, params, { ...options, toIndex: split });
      ranked.push({ params, metrics: r.metrics, s: score(r.metrics) });
    }
    ranked.sort((a, b) => (b.s === a.s ? 0 : b.s - a.s));

    let best: OptimiseEntry | null = null;
    for (const candidate of ranked.slice(0, 3)) {
      const oos = runBacktest(candles, def, candidate.params, { ...options, fromIndex: split });
      const entry: OptimiseEntry = {
        strategy_id: def.id,
        strategy_name: def.name,
        params: candidate.params,
        in_sample: candidate.metrics,
        out_of_sample: oos.metrics,
        oos_score: score(oos.metrics),
        combos_tested: combos,
        equity: oos.equity,
      };
      if (!best || entry.oos_score > best.oos_score) best = entry;
    }
    if (best) results.push(best);
  }

  return results.sort((a, b) => (b.oos_score === a.oos_score ? 0 : b.oos_score - a.oos_score));
}
