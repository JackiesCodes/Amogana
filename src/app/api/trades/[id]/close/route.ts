import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { closeTrade } from "@/lib/trading/engine";
import { getStore, newId, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const store = getStore();
  const trade = await store.trades.get(params.id);
  if (!trade) return jsonError(404, "TRADE_NOT_FOUND");

  // Positions opened outside Amogana on MT5 are closed by ticket through the bridge.
  if (trade.external && trade.broker_account_id) {
    const broker = await store.brokers.get(trade.broker_account_id);
    if (broker?.kind === "mt5") {
      await store.commands.insert({
        id: newId(),
        account_id: broker.id,
        trade_id: trade.id,
        type: "close",
        payload: { ticket: trade.broker_ref },
        status: "queued",
        result: null,
        created_at: nowIso(),
        sent_at: null,
      });
      return NextResponse.json(await store.trades.update(trade.id, { close_reason: "Closed from dashboard" }));
    }
  }

  try {
    return NextResponse.json(await closeTrade(trade, "Closed from dashboard"));
  } catch (error) {
    return jsonError(502, "CLOSE_FAILED", (error as Error).message);
  }
}
