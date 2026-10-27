// Edge-compatible (Web Crypto only): imported by middleware.ts.

export const SESSION_COOKIE = "amogana_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || null;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(): Promise<{ value: string; maxAge: number }> {
  const secret = sessionSecret();
  if (!secret) throw new Error("APP_PASSWORD is not configured");
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return { value: `${expires}.${await hmacHex(secret, String(expires))}`, maxAge: SESSION_TTL_SECONDS };
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret || !token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return constantTimeEqual(sig, await hmacHex(secret, expires));
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  // Compare HMACs so the comparison length never leaks the password length.
  const [a, b] = await Promise.all([hmacHex("pw", candidate), hmacHex("pw", password)]);
  return constantTimeEqual(a, b);
}
