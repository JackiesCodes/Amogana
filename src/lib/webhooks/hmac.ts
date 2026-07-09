import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export interface HmacVerificationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Verifies an inbound webhook signature using HMAC-SHA256 over the raw
 * request body. Providers are expected to send a hex-encoded signature in
 * a header such as `X-Orange-Signature` computed as:
 *
 *   hex(HMAC_SHA256(secret, rawRequestBody))
 *
 * The raw (unparsed) body MUST be used — re-serialising parsed JSON can
 * change key ordering/whitespace and silently break verification.
 */
export function verifyHmacSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string | undefined;
}): HmacVerificationResult {
  const { rawBody, signatureHeader, secret } = params;

  if (!secret) {
    return { isValid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  }

  if (!signatureHeader) {
    return { isValid: false, reason: "MISSING_SIGNATURE_HEADER" };
  }

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return { isValid: false, reason: "SIGNATURE_LENGTH_MISMATCH" };
  }

  const isValid = timingSafeEqual(expectedBuffer, providedBuffer);
  return isValid ? { isValid: true } : { isValid: false, reason: "SIGNATURE_MISMATCH" };
}

export function signPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}
