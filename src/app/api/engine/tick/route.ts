import { NextResponse } from "next/server";

import { runEngineTick } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Session-authenticated (middleware): the open dashboard calls this every minute.
export async function POST() {
  return NextResponse.json(await runEngineTick());
}
