import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, details }, { status });
}

export function zodError(error: ZodError) {
  return jsonError(400, "INVALID_REQUEST", error.flatten().fieldErrors);
}
