export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  /** Values the optimiser tries. */
  grid: number[];
}

export interface StrategyDefinition {
  id: string;
  name: string;
  style: string;
  description: string;
  params: ParamSpec[];
  /**
   * Desired position after each bar closes: 1 long, -1 short, 0 flat.
   * Must only use data up to and including bar i (no look-ahead).
   */
  positions(candles: Candle[], params: Record<string, number>): Int8Array;
}
