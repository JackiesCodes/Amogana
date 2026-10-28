import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { activeTrades, adjustBaseline, bookOf, syncDerivAccount } from "@/lib/trading/engine";
import { publicBroker } from "@/lib/trading/state";
import { getStore, log } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/** Re-sync now (Deriv) — MT5 accounts sync themselves via the bridge. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const broker = await store.brokers.get(params.id);
  if (!broker) return jsonError(404, "BROKER_NOT_FOUND");
  if (broker.kind === "deriv") await syncDerivAccount(broker);
  return NextResponse.json(publicBroker((await store.brokers.get(broker.id))!));
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const broker = await store.brokers.get(params.id);
  if (!broker) return jsonError(404, "BROKER_NOT_FOUND");
  if ((await activeTrades({ broker_account_id: broker.id })).some((t) => !t.external)) {
    return jsonError(409, "CLOSE_TRADES_FIRST");
  }
  const bots = await store.bots.all({ eq: { broker_account_id: broker.id } });
  for (const bot of bots) {
    await store.bots.update(bot.id, {
      broker_account_id: null,
      status: "paused",
      paused_reason: "Broker disconnected — choose another account",
    });
  }
  for (const trade of await activeTrades({ broker_account_id: broker.id })) await store.trades.remove(trade.id);
  await store.brokers.remove(broker.id);
  await adjustBaseline(bookOf(broker), -broker.equity);
  await log("warn", `${broker.label} disconnected${bots.length ? `; ${bots.length} bot(s) paused until you choose another account` : ""}`);
  return NextResponse.json({ ok: true });
}
