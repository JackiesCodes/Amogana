import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHmacSignature } from "@/lib/webhooks/hmac";
import { orangeMoneyWebhookSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives asynchronous payment-status callbacks from Orange Money.
 *
 * Expected headers:
 *   X-Orange-Signature: hex(HMAC_SHA256(ORANGE_MONEY_WEBHOOK_SECRET, rawBody))
 *
 * Orange Money's callback contract only ever reports on a transaction that
 * Amogana itself initiated (via `create_pending_settlement`), so the
 * `transaction_id` in the payload must already exist in `transactions`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-orange-signature");

  const verification = verifyHmacSignature({
    rawBody,
    signatureHeader,
    secret: process.env.ORANGE_MONEY_WEBHOOK_SECRET,
  });

  const admin = createAdminClient();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = orangeMoneyWebhookSchema.safeParse(payload);

  // Persist every inbound attempt — valid or not — for audit purposes before
  // deciding how to respond. Signature failures are logged, never trusted.
  const { data: eventRecord, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "orange_money",
      event_id: parsed.success ? parsed.data.event_id : `invalid:${crypto.randomUUID()}`,
      transaction_id: parsed.success ? parsed.data.transaction_id : null,
      signature_valid: verification.isValid,
      payload: parsed.success ? parsed.data : { raw: rawBody.slice(0, 2000) },
    })
    .select("id")
    .maybeSingle();

  if (insertError && insertError.code === "23505") {
    // Duplicate delivery of an event we've already recorded — acknowledge
    // without reprocessing so Orange Money's retry logic doesn't loop.
    return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
  }

  if (!verification.isValid) {
    return NextResponse.json(
      { error: "INVALID_SIGNATURE", reason: verification.reason },
      { status: 401 },
    );
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { transaction_id, status, carrier_reference, failure_reason } = parsed.data;

  try {
    if (status === "SUCCESSFUL") {
      await admin.rpc("settle_pending_transaction", {
        p_transaction_id: transaction_id,
        p_external_reference: carrier_reference,
      });
    } else if (status === "FAILED") {
      await admin.rpc("fail_pending_transaction", {
        p_transaction_id: transaction_id,
        p_reason: failure_reason ?? "Orange Money declined the transaction.",
      });
    } else {
      await admin
        .from("transactions")
        .update({ status: "processing" })
        .eq("id", transaction_id)
        .eq("status", "pending");
    }
  } catch (rpcError) {
    const message = rpcError instanceof Error ? rpcError.message : "Unknown settlement error";
    return NextResponse.json({ error: "SETTLEMENT_FAILED", message }, { status: 500 });
  }

  if (eventRecord) {
    await admin
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", eventRecord.id);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
