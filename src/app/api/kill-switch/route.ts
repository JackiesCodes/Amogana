import { NextResponse } from "next/server";
import { z } from "zod";

import { zodError } from "@/lib/http";
import { setKillSwitch } from "@/lib/trading/engine";
import { getSettings } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ on: z.boolean() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  await setKillSwitch(parsed.data.on);
  return NextResponse.json(await getSettings());
}
