import { NextResponse } from "next/server";
import { z } from "zod";

import { derivAuthorize } from "@/lib/brokers/deriv";
import { jsonError, zodError } from "@/lib/http";
import { encryptSecret, randomToken, sha256 } from "@/lib/secrets";
import { adjustBaseline, bookOf } from "@/lib/trading/engine";
import { publicBroker } from "@/lib/trading/state";
import { getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { BrokerAccount } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deriv"), label: z.string().trim().max(40).optional(), token: z.string().trim().min(8) }),
  z.object({ kind: z.literal("mt5"), label: z.string().trim().max(40).optional() }),
]);

export async function GET() {
  const brokers = await getStore().brokers.all({ order: { field: "created_at" } });
  return NextResponse.json(brokers.map(publicBroker));
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;
  const store = getStore();

  const base: BrokerAccount = {
    id: newId(),
    kind: input.kind,
    label: input.label || (input.kind === "deriv" ? "Deriv" : "Exness MT5"),
    status: "waiting",
    login: null,
    server: null,
    currency: "USD",
    balance: 0,
    equity: 0,
    is_demo: false,
    encrypted_token: null,
    bridge_key_hash: null,
    last_sync_at: null,
    error: null,
    created_at: nowIso(),
  };

  if (input.kind === "deriv") {
    let info;
    try {
      info = await derivAuthorize(input.token);
    } catch (error) {
      return jsonError(400, "DERIV_TOKEN_REJECTED", (error as Error).message);
    }
    if (!info.scopes.includes("trade")) return jsonError(400, "DERIV_TOKEN_NEEDS_TRADE_SCOPE");
    if (info.scopes.includes("payments") || info.scopes.includes("admin")) {
      return jsonError(400, "DERIV_TOKEN_TOO_POWERFUL", "Create a token with only Read + Trade scopes.");
    }
    const account: BrokerAccount = {
      ...base,
      status: "connected",
      login: info.loginid,
      currency: info.currency,
      balance: info.balance,
      equity: info.balance,
      is_demo: info.is_virtual,
      encrypted_token: encryptSecret(input.token),
      last_sync_at: nowIso(),
    };
    await store.brokers.insert(account);
    await adjustBaseline(bookOf(account), account.equity);
    await log("info", `Deriv account ${info.loginid}${info.is_virtual ? " (demo)" : ""} connected`);
    return NextResponse.json({ broker: publicBroker(account) }, { status: 201 });
  }

  // MT5: generate a bridge key the EA will present. It is shown once, only its hash is stored.
  const bridgeKey = `amg_${randomToken(24)}`;
  const account: BrokerAccount = { ...base, bridge_key_hash: sha256(bridgeKey) };
  await store.brokers.insert(account);
  await log("info", `${account.label} added — waiting for the MT5 bridge to connect`);
  return NextResponse.json({ broker: publicBroker(account), bridge_key: bridgeKey }, { status: 201 });
}
