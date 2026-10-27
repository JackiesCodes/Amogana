import { NextResponse } from "next/server";
import { z } from "zod";

import { zodError } from "@/lib/http";
import { getSettings, log, updateSettings } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  daily_loss_limit: z.coerce.number().min(0).optional(),
  max_drawdown_percent: z.coerce.number().min(0).max(100).optional(),
  max_open_trades: z.coerce.number().int().min(1).max(100).optional(),
  max_trades_per_bot: z.coerce.number().int().min(1).max(10).optional(),
  default_risk_percent: z.coerce.number().min(0.1).max(5).optional(),
  paper_starting_balance: z.coerce.number().min(100).optional(),
});

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const settings = await updateSettings(parsed.data);
  await log("info", "Risk Guard settings updated", { context: parsed.data });
  return NextResponse.json(settings);
}
