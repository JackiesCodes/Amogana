import type { Book, BookState, Bot, Settings } from "@/lib/trading/types";

export interface RiskInput {
  settings: Settings;
  book: Book;
  bot: Bot;
  equity: number;
  bookState: BookState;
  openTradesInBook: number;
  openTradesForBot: number;
}

export type RiskDecision =
  | { ok: true; riskAmount: number }
  | { ok: false; reason: string; breach?: "daily_loss" | "drawdown" };

/** Pure pre-trade check: every order passes through here before it can reach a broker. */
export function checkRisk(input: RiskInput): RiskDecision {
  const { settings, bot, equity, bookState } = input;

  if (settings.kill_switch) return { ok: false, reason: "Kill switch is on" };
  if (bot.status !== "running") return { ok: false, reason: "Bot is paused" };
  if (equity <= 0) return { ok: false, reason: "No equity available on this account" };

  const dayLoss = bookState.day_start_equity - equity;
  if (settings.daily_loss_limit > 0 && dayLoss >= settings.daily_loss_limit) {
    return { ok: false, reason: `Daily loss limit reached (${dayLoss.toFixed(2)})`, breach: "daily_loss" };
  }

  const drawdown = bookState.peak_equity > 0 ? ((bookState.peak_equity - equity) / bookState.peak_equity) * 100 : 0;
  if (settings.max_drawdown_percent > 0 && drawdown >= settings.max_drawdown_percent) {
    return { ok: false, reason: `Max drawdown reached (${drawdown.toFixed(1)}%)`, breach: "drawdown" };
  }

  if (input.openTradesInBook >= settings.max_open_trades) {
    return { ok: false, reason: `Max open trades reached (${settings.max_open_trades})` };
  }
  if (input.openTradesForBot >= settings.max_trades_per_bot) {
    return { ok: false, reason: "Bot already has its maximum open trades" };
  }

  const riskPercent = Math.min(bot.risk_percent || settings.default_risk_percent, 5);
  return { ok: true, riskAmount: (equity * riskPercent) / 100 };
}

/** Roll the day and track the equity peak. Returns the updated state. */
export function advanceBookState(state: BookState, equity: number, today: string): BookState {
  const next = { ...state };
  if (next.day_key !== today) {
    next.day_key = today;
    next.day_start_equity = equity;
  }
  if (equity > next.peak_equity) next.peak_equity = equity;
  return next;
}

/** Deriv Multiplier stake so that hitting the stop loses ≈ riskAmount. */
export function derivStake(params: {
  riskAmount: number;
  entry: number;
  stopDistance: number | null;
  multiplier: number;
  equity: number;
}): { stake: number; stopLossAmount: number | undefined } {
  const { riskAmount, entry, stopDistance, multiplier, equity } = params;
  if (!stopDistance || stopDistance <= 0 || !entry) {
    // A multiplier contract can never lose more than its stake.
    return { stake: Math.max(1, riskAmount), stopLossAmount: undefined };
  }
  const raw = (riskAmount * entry) / (multiplier * stopDistance);
  const stake = Math.max(1, Math.min(raw, equity * 0.25));
  return { stake, stopLossAmount: Math.min(riskAmount, stake) };
}
