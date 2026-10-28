import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, zodError } from "@/lib/http";
import { randomToken } from "@/lib/secrets";
import { defaultParams, getStrategy } from "@/lib/strategies";
import { guessDataSymbol } from "@/lib/trading/symbols";
import { getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const botInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  source: z.enum(["builtin", "tradingview"]),
  broker_account_id: z.string().min(1),
  symbol: z.string().trim().min(1).max(30),
  data_symbol: z.string().trim().max(30).optional(),
  timeframe: z.coerce.number().int().positive().default(3600),
  strategy_id: z.string().optional(),
  strategy_params: z.record(z.coerce.number()).optional(),
  risk_percent: z.coerce.number().min(0.1).max(5).default(1),
  deriv_multiplier: z.coerce.number().int().min(1).max(5000).default(100),
});

export async function GET() {
  return NextResponse.json(await getStore().bots.all({ order: { field: "created_at" } }));
}

export async function POST(request: Request) {
  const parsed = botInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;
  const store = getStore();

  const broker = await store.brokers.get(input.broker_account_id);
  if (!broker) return jsonError(400, "UNKNOWN_BROKER");

  let strategy: Bot["strategy"] = null;
  if (input.source === "builtin") {
    const def = getStrategy(input.strategy_id ?? "");
    if (!def) return jsonError(400, "UNKNOWN_STRATEGY");
    strategy = { id: def.id, params: { ...defaultParams(def), ...input.strategy_params } };
  }

  const existing = await store.bots.all();
  const bot: Bot = {
    id: newId(),
    name: input.name,
    source: input.source,
    broker_account_id: broker.id,
    symbol: input.symbol,
    data_symbol: input.data_symbol || guessDataSymbol(input.symbol),
    timeframe: input.timeframe,
    strategy,
    status: "paused",
    paused_reason: "New bot — press Start when ready",
    risk_percent: input.risk_percent,
    deriv_multiplier: input.deriv_multiplier,
    magic: nextMagic(existing),
    webhook_passphrase: randomToken(18),
    last_bar_epoch: null,
    last_signal_at: null,
    created_at: nowIso(),
  };
  await store.bots.insert(bot);
  await log("info", `Bot "${bot.name}" created on ${broker.label}${broker.is_demo ? " (demo)" : ""}`, { bot_id: bot.id });
  return NextResponse.json(bot, { status: 201 });
}

function nextMagic(existing: Bot[]): number {
  const used = new Set(existing.map((b) => b.magic));
  let magic = 770001;
  while (used.has(magic)) magic++;
  return magic;
}
