import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { jsonError, zodError } from "@/lib/http";
import { processSignal } from "@/lib/trading/engine";
import { getStore, log } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/**
 * TradingView alert webhook. TradingView cannot sign requests or set
 * headers, so each bot has its own passphrase that must be in the JSON body.
 * Alert message template (shown per bot on the Bots page):
 *
 *   {"bot_id":"…","passphrase":"…","action":"{{strategy.order.action}}",
 *    "price":{{close}},"id":"{{timenow}}"}
 *
 * Optional: "sl", "tp" (prices). "action" accepts buy / sell / close
 * (plus long / short / exit / flat aliases).
 */
const ACTIONS: Record<string, "buy" | "sell" | "close"> = {
  buy: "buy",
  long: "buy",
  sell: "sell",
  short: "sell",
  close: "close",
  exit: "close",
  flat: "close",
};

const schema = z.object({
  bot_id: z.string().min(1),
  passphrase: z.string().min(1),
  action: z.string().transform((a) => ACTIONS[a.trim().toLowerCase()]),
  price: z.coerce.number().positive().optional(),
  sl: z.coerce.number().positive().optional(),
  tp: z.coerce.number().positive().optional(),
  id: z.coerce.string().optional(),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "BODY_MUST_BE_JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;
  if (!input.action) return jsonError(400, "UNKNOWN_ACTION");

  const bot = await getStore().bots.get(input.bot_id);
  if (!bot || !safeEqual(bot.webhook_passphrase, input.passphrase)) {
    await log("warn", "TradingView webhook with bad bot id or passphrase ignored");
    return jsonError(401, "INVALID_BOT_OR_PASSPHRASE");
  }

  const signal = await processSignal({
    bot,
    source: "tradingview",
    action: input.action,
    price: input.price,
    sl: input.sl,
    tp: input.tp,
    external_id: input.id ?? null,
  });
  // Always 200 for authenticated requests so TradingView doesn't retry rejected-by-risk signals.
  return NextResponse.json({ status: signal.status, reason: signal.reason });
}
