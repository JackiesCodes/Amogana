import { NextResponse } from "next/server";
import { z } from "zod";

import { derivAccounts } from "@/lib/brokers/deriv";
import { jsonError, zodError } from "@/lib/http";
import { encryptSecret, randomToken, sha256 } from "@/lib/secrets";
import { adjustBaseline, bookOf } from "@/lib/trading/engine";
import { publicBroker } from "@/lib/trading/state";
import { getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { BrokerAccount } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deriv"),
    label: z.string().trim().max(40).optional(),
    token: z.string().trim().min(8),
    app_id: z.string().trim().min(1).max(64),
  }),
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
    app_id: null,
    bridge_key_hash: null,
    last_sync_at: null,
    error: null,
    created_at: nowIso(),
  };

  if (input.kind === "deriv") {
    let accounts;
    try {
      accounts = await derivAccounts(input.token, input.app_id);
    } catch (error) {
      return jsonError(400, "DERIV_TOKEN_REJECTED", (error as Error).message);
    }
    const active = accounts.filter((a) => a.status === "active");
    if (!active.length) return jsonError(400, "DERIV_NO_OPTIONS_ACCOUNTS");

    // One connection per Deriv Options account (demo and/or real) the token can reach.
    const existing = new Set((await store.brokers.all({ eq: { kind: "deriv" } })).map((b) => b.login));
    const encrypted = encryptSecret(input.token);
    const added: BrokerAccount[] = [];
    for (const a of active) {
      if (existing.has(a.account_id)) continue;
      const isDemo = a.account_type === "demo";
      const account: BrokerAccount = {
        ...base,
        id: newId(),
        label: input.label || `Deriv ${isDemo ? "Demo" : "Real"} ${a.account_id}`,
        status: "connected",
        login: a.account_id,
        currency: a.currency,
        balance: a.balance,
        equity: a.balance,
        is_demo: isDemo,
        encrypted_token: encrypted,
        app_id: input.app_id,
        last_sync_at: nowIso(),
      };
      await store.brokers.insert(account);
      await adjustBaseline(bookOf(account), account.equity);
      await log("info", `Deriv ${isDemo ? "demo" : "real"} account ${a.account_id} connected`);
      added.push(account);
    }
    if (!added.length) return jsonError(409, "DERIV_ALREADY_CONNECTED");
    return NextResponse.json({ brokers: added.map(publicBroker) }, { status: 201 });
  }

  // MT5: generate a bridge key the EA will present. It is shown once, only its hash is stored.
  const bridgeKey = `bt_${randomToken(24)}`;
  const account: BrokerAccount = { ...base, bridge_key_hash: sha256(bridgeKey) };
  await store.brokers.insert(account);
  await log("info", `${account.label} added — waiting for the MT5 bridge to connect`);
  return NextResponse.json({ broker: publicBroker(account), bridge_key: bridgeKey }, { status: 201 });
}
