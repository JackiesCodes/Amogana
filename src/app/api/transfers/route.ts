import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transferRequestSchema } from "@/lib/validation";
import type { Transaction, TransactionType, Wallet } from "@/lib/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TransferErrorBody {
  error: string;
  message: string;
}

const PG_ERROR_STATUS: Record<string, { status: number; message: string }> = {
  P0001: { status: 402, message: "Insufficient funds in the source wallet." },
  P0002: { status: 404, message: "One of the specified wallets could not be found." },
  P0003: { status: 422, message: "No FX rate is currently available for this currency pair." },
  P0004: { status: 409, message: "This transaction is no longer in a settleable state." },
};

function inferTransactionType(source: Wallet, destination: Wallet): TransactionType {
  if (destination.category === "trading" || destination.category === "sportsbook") {
    return "merchant_payment";
  }
  if (source.currency_code !== destination.currency_code) {
    return "fx_swap";
  }
  return "transfer";
}

function errorResponse(status: number, error: string, message: string): NextResponse<TransferErrorBody> {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = transferRequestSchema.safeParse(body);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    return NextResponse.json(
      { error: "VALIDATION_ERROR", message: "Request payload failed validation.", details: flattened },
      { status: 400 },
    );
  }

  const { sourceWalletId, destinationWalletId, amount, idempotencyKey, narrative } = parsed.data;

  if (sourceWalletId === destinationWalletId) {
    return errorResponse(400, "SAME_WALLET", "Source and destination wallets must be different.");
  }

  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse(401, "UNAUTHENTICATED", "You must be signed in to initiate a transfer.");
  }

  const admin = createAdminClient();

  const { data: sourceWallet, error: sourceError } = await admin
    .from("wallets")
    .select("*")
    .eq("id", sourceWalletId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sourceError) {
    return errorResponse(500, "DATABASE_ERROR", sourceError.message);
  }
  if (!sourceWallet) {
    return errorResponse(404, "SOURCE_WALLET_NOT_FOUND", "Source wallet not found for this account.");
  }
  if (!sourceWallet.is_active) {
    return errorResponse(409, "SOURCE_WALLET_INACTIVE", "The source wallet is currently inactive.");
  }
  if (sourceWallet.available_balance < amount) {
    return errorResponse(402, "INSUFFICIENT_FUNDS", "Insufficient available balance in the source wallet.");
  }

  const { data: destinationWallet, error: destError } = await admin
    .from("wallets")
    .select("*")
    .eq("id", destinationWalletId)
    .maybeSingle();

  if (destError) {
    return errorResponse(500, "DATABASE_ERROR", destError.message);
  }
  if (!destinationWallet || !destinationWallet.is_active) {
    return errorResponse(404, "DESTINATION_WALLET_NOT_FOUND", "Destination wallet not found or inactive.");
  }

  const transactionType = inferTransactionType(sourceWallet, destinationWallet);

  const { data: transaction, error: rpcError } = await admin.rpc("execute_ledger_transfer", {
    p_user_id: user.id,
    p_sender_wallet_id: sourceWallet.id,
    p_receiver_wallet_id: destinationWallet.id,
    p_source_amount: amount,
    p_type: transactionType,
    p_fee_amount: 0,
    p_idempotency_key: idempotencyKey ?? null,
    p_metadata: {
      narrative,
      initiated_via: "dashboard",
      destination_provider: destinationWallet.provider_name,
    },
  });

  if (rpcError) {
    const mapped = PG_ERROR_STATUS[rpcError.code ?? ""];
    if (mapped) {
      return errorResponse(mapped.status, rpcError.code as string, mapped.message);
    }
    return errorResponse(500, "TRANSFER_FAILED", rpcError.message);
  }

  return NextResponse.json(
    { transaction: transaction as Transaction },
    { status: 201 },
  );
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return errorResponse(401, "UNAUTHENTICATED", "You must be signed in to view transfers.");
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsedQuery = listQuerySchema.safeParse(searchParams);
  const limit = parsedQuery.success ? parsedQuery.data.limit : 25;

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return errorResponse(500, "DATABASE_ERROR", error.message);
  }

  return NextResponse.json({ transactions: data as Transaction[] });
}
