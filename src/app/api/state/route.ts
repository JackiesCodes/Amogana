import { NextResponse } from "next/server";

import { getDashboardState } from "@/lib/trading/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getDashboardState());
}
