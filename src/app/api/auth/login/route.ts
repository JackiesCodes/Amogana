import { NextResponse } from "next/server";

import { SESSION_COOKIE, checkPassword, createSessionToken } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!process.env.APP_PASSWORD) return jsonError(503, "APP_PASSWORD_NOT_SET");
  if (!password || !(await checkPassword(password))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return jsonError(401, "WRONG_PASSWORD");
  }
  const { value, maxAge } = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
  return response;
}
