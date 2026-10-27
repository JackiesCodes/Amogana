import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, zodError } from "@/lib/http";
import { getStrategy } from "@/lib/strategies";
import { activeTrades, closeTrade } from "@/lib/trading/engine";
import { getSettings, getStore, log } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["running", "paused"]).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  book: z.enum(["paper", "live"]).optional(),
  broker_account_id: z.string().nullable().optional(),
  risk_percent: z.coerce.number().min(0.1).max(5).optional(),
  deriv_multiplier: z.coerce.number().int().min(1).max(5000).optional(),
  timeframe: z.coerce.number().int().positive().optional(),
  strategy_params: z.record(z.coerce.number()).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { strategy_params, ...rest } = parsed.data;

  const patch: Partial<Bot> = { ...rest };
  if (strategy_params && bot.strategy && getStrategy(bot.strategy.id)) {
    patch.strategy = { ...bot.strategy, params: { ...bot.strategy.params, ...strategy_params } };
  }

  const nextBook = patch.book ?? bot.book;
  const nextBroker = patch.broker_account_id !== undefined ? patch.broker_account_id : bot.broker_account_id;
  if (nextBook === "live" && !nextBroker) return jsonError(400, "LIVE_BOT_NEEDS_BROKER");
  if (patch.book && patch.book !== bot.book && (await activeTrades({ bot_id: bot.id })).length) {
    return jsonError(409, "CLOSE_TRADES_BEFORE_SWITCHING_MODE");
  }

  if (patch.status === "running") {
    if ((await getSettings()).kill_switch) return jsonError(409, "KILL_SWITCH_ON");
    patch.paused_reason = null;
  } else if (patch.status === "paused") {
    patch.paused_reason = "Paused by you";
  }

  const updated = await store.bots.update(bot.id, patch);
  if (patch.status && patch.status !== bot.status) {
    await log("info", `Bot "${bot.name}" ${patch.status === "running" ? "started" : "paused"}`, { bot_id: bot.id });
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");
  for (const trade of await activeTrades({ bot_id: bot.id })) await closeTrade(trade, "Bot deleted");
  await store.bots.remove(bot.id);
  await log("info", `Bot "${bot.name}" deleted`);
  return NextResponse.json({ ok: true });
}
