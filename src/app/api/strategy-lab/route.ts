import { NextResponse } from "next/server";
import { z } from "zod";

import { derivCandles } from "@/lib/brokers/deriv";
import { jsonError, zodError } from "@/lib/http";
import { defaultParams, getStrategy } from "@/lib/strategies";
import { optimise, runBacktest } from "@/lib/strategies/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  action: z.enum(["backtest", "optimise"]),
  data_symbol: z.string().min(1),
  timeframe: z.coerce.number().int().positive(),
  bars: z.coerce.number().int().min(300).max(5000).default(5000),
  strategy_id: z.string().optional(),
  params: z.record(z.coerce.number()).optional(),
  risk_percent: z.coerce.number().min(0.1).max(5).default(1),
  cost_percent: z.coerce.number().min(0).max(1).default(0.02),
  initial_balance: z.coerce.number().min(100).default(10000),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;

  let candles;
  try {
    candles = await derivCandles(input.data_symbol, input.timeframe, input.bars);
  } catch (error) {
    return jsonError(502, "MARKET_DATA_UNAVAILABLE", (error as Error).message);
  }
  if (candles.length < 300) return jsonError(422, "NOT_ENOUGH_HISTORY");

  const options = {
    initialBalance: input.initial_balance,
    riskPercent: input.risk_percent,
    costPercent: input.cost_percent,
    timeframe: input.timeframe,
  };
  const range = { from: candles[0]!.epoch, to: candles[candles.length - 1]!.epoch, bars: candles.length };

  if (input.action === "optimise") {
    return NextResponse.json({ range, leaderboard: optimise(candles, options) });
  }

  const def = getStrategy(input.strategy_id ?? "");
  if (!def) return jsonError(400, "UNKNOWN_STRATEGY");
  const params = { ...defaultParams(def), ...input.params };
  const result = runBacktest(candles, def, params, options);
  return NextResponse.json({ range, params, ...result, trades: result.trades.slice(-200) });
}
