import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, zodError } from "@/lib/http";
import { processSignal } from "@/lib/trading/engine";
import { getStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["buy", "sell", "close"]),
  sl: z.coerce.number().positive().nullable().optional(),
  tp: z.coerce.number().positive().nullable().optional(),
});

/** Manual trade from the dashboard, routed through the same risk checks as bot signals. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const bot = await getStore().bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const signal = await processSignal({ bot, source: "manual", ...parsed.data });
  return NextResponse.json(signal, { status: signal.status === "accepted" ? 200 : 422 });
}
