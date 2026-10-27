import { describe, expect, it } from "vitest";

import { advanceBookState, checkRisk, derivStake } from "@/lib/trading/risk";
import { DEFAULT_SETTINGS } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

const bot = { status: "running", risk_percent: 1 } as Bot;
const base = {
  settings: DEFAULT_SETTINGS,
  book: "paper" as const,
  bot,
  equity: 10_000,
  bookState: { peak_equity: 10_000, day_key: "2026-01-01", day_start_equity: 10_000 },
  openTradesInBook: 0,
  openTradesForBot: 0,
};

describe("checkRisk", () => {
  it("sizes risk from equity", () => {
    expect(checkRisk(base)).toEqual({ ok: true, riskAmount: 100 });
  });

  it("caps per-trade risk at 5%", () => {
    expect(checkRisk({ ...base, bot: { ...bot, risk_percent: 20 } })).toEqual({ ok: true, riskAmount: 500 });
  });

  it("blocks on kill switch, daily loss, drawdown and trade limits", () => {
    expect(checkRisk({ ...base, settings: { ...DEFAULT_SETTINGS, kill_switch: true } }).ok).toBe(false);
    expect(checkRisk({ ...base, equity: 9_700 })).toMatchObject({ ok: false, breach: "daily_loss" });
    expect(
      checkRisk({ ...base, equity: 8_400, bookState: { ...base.bookState, day_start_equity: 8_400 } }),
    ).toMatchObject({ ok: false, breach: "drawdown" });
    expect(checkRisk({ ...base, openTradesInBook: 8 }).ok).toBe(false);
    expect(checkRisk({ ...base, openTradesForBot: 1 }).ok).toBe(false);
  });
});

describe("advanceBookState", () => {
  it("rolls the day and tracks the peak", () => {
    const s = advanceBookState({ peak_equity: 100, day_key: "a", day_start_equity: 100 }, 120, "b");
    expect(s).toEqual({ peak_equity: 120, day_key: "b", day_start_equity: 120 });
  });
});

describe("derivStake", () => {
  it("loses ≈ the risk amount at the stop", () => {
    const { stake, stopLossAmount } = derivStake({ riskAmount: 10, entry: 1.1, stopDistance: 0.0055, multiplier: 100, equity: 1000 });
    expect(stake * 100 * (0.0055 / 1.1)).toBeCloseTo(10);
    expect(stopLossAmount).toBe(10);
  });

  it("never stakes more than a quarter of equity", () => {
    expect(derivStake({ riskAmount: 10, entry: 1.1, stopDistance: 0.00001, multiplier: 100, equity: 1000 }).stake).toBe(250);
  });
});
