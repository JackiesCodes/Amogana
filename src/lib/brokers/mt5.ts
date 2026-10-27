import "server-only";

import { z } from "zod";

import { adjustLiveBaseline } from "@/lib/trading/engine";
import { getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { BrokerAccount, Mt5Command, Trade } from "@/lib/trading/types";

/**
 * Server side of the MetaTrader 5 bridge (public/downloads/AmoganaBridge.mq5).
 *
 * MT5 has no inbound API, so the bridge EA running in your terminal calls
 * POST /api/mt5/sync every few seconds with its account state, positions,
 * recently closed deals and the results of earlier commands. The response
 * carries the next queued commands as plain text lines (easy to parse in
 * MQL5):
 *
 *   id|type|symbol|side|risk_money|sl|tp|magic|ticket|comment
 */

const num = z.coerce.number();

export const mt5ReportSchema = z.object({
  login: z.coerce.string(),
  server: z.string().default(""),
  company: z.string().default(""),
  currency: z.string().default("USD"),
  balance: num,
  equity: num,
  is_demo: z.coerce.boolean().default(false),
  positions: z
    .array(
      z.object({
        ticket: z.coerce.string(),
        symbol: z.string(),
        type: z.enum(["buy", "sell"]),
        volume: num,
        price_open: num,
        price_current: num,
        sl: num.default(0),
        tp: num.default(0),
        profit: num,
        magic: num.default(0),
        comment: z.string().default(""),
      }),
    )
    .default([]),
  deals: z
    .array(
      z.object({
        position_id: z.coerce.string(),
        profit: num,
        price: num,
      }),
    )
    .default([]),
  results: z
    .array(
      z.object({
        command_id: z.string(),
        ok: z.coerce.boolean(),
        ticket: z.coerce.string().optional(),
        price: num.optional(),
        volume: num.optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
});

export type Mt5Report = z.infer<typeof mt5ReportSchema>;

export async function ingestMt5Report(account: BrokerAccount, report: Mt5Report): Promise<string> {
  const store = getStore();
  await store.brokers.update(account.id, {
    login: report.login,
    server: report.server,
    currency: report.currency,
    balance: report.balance,
    equity: report.equity,
    is_demo: report.is_demo,
    status: "connected",
    error: null,
    last_sync_at: nowIso(),
  });
  // First check-in: the account's equity joins the live book without counting as profit.
  if (!account.last_sync_at) await adjustLiveBaseline(report.equity - account.equity);

  // 1. Results of commands sent last time.
  for (const r of report.results) {
    const command = await store.commands.get(r.command_id);
    if (!command || command.account_id !== account.id) continue;
    await store.commands.update(command.id, { status: r.ok ? "done" : "failed", result: r });
    if (!command.trade_id || command.type !== "open") {
      if (!r.ok) await log("error", `MT5 ${command.type} failed: ${r.error ?? "unknown error"}`);
      continue;
    }
    const trade = await store.trades.get(command.trade_id);
    if (!trade) continue;
    if (r.ok) {
      await store.trades.update(trade.id, {
        status: "open",
        broker_ref: r.ticket ?? null,
        entry_price: r.price ?? trade.entry_price,
        size: r.volume ?? trade.size,
      });
      await log("trade", `MT5 filled ${trade.side.toUpperCase()} ${trade.symbol} ${r.volume} lots @ ${r.price}`, {
        bot_id: trade.bot_id,
      });
    } else {
      await store.trades.update(trade.id, { status: "rejected", close_reason: r.error ?? "Rejected by MT5", closed_at: nowIso() });
      await log("error", `MT5 rejected ${trade.symbol}: ${r.error ?? "unknown error"}`, { bot_id: trade.bot_id });
    }
  }

  // 2. Reconcile positions.
  const active = await store.trades.all({ eq: { broker_account_id: account.id }, in: { field: "status", values: ["pending", "open"] } });
  const byTicket = new Map(report.positions.map((p) => [p.ticket, p]));
  const seen = new Set<string>();

  for (const trade of active) {
    let position = trade.broker_ref ? byTicket.get(trade.broker_ref) : undefined;
    // Link a fill whose result report was lost, via the order comment.
    if (!position && !trade.broker_ref) {
      position = report.positions.find((p) => p.comment === `amg:${trade.id.slice(0, 8)}`);
    }
    if (position) {
      seen.add(position.ticket);
      await store.trades.update(trade.id, {
        status: "open",
        broker_ref: position.ticket,
        entry_price: position.price_open,
        current_price: position.price_current,
        size: position.volume,
        sl: position.sl || null,
        tp: position.tp || null,
        pnl: position.profit,
      });
    } else if (trade.status === "open" && trade.broker_ref) {
      const closing = report.deals.filter((d) => d.position_id === trade.broker_ref);
      const pnl = closing.length ? closing.reduce((s, d) => s + d.profit, 0) : trade.pnl;
      await store.trades.update(trade.id, {
        status: "closed",
        pnl,
        exit_price: closing.at(-1)?.price ?? trade.current_price,
        close_reason: trade.close_reason ?? "Closed on MT5 (stop/target/manual)",
        closed_at: nowIso(),
      });
      await log("trade", `MT5 closed ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, { bot_id: trade.bot_id });
    }
  }

  // 3. Positions opened outside Amogana (your own EAs or manual trades).
  const bots = await store.bots.all({ eq: { broker_account_id: account.id } });
  for (const p of report.positions) {
    if (seen.has(p.ticket)) continue;
    const bot = bots.find((b) => b.magic === p.magic && p.magic !== 0);
    const trade: Trade = {
      id: newId(),
      bot_id: bot?.id ?? null,
      broker_account_id: account.id,
      book: "live",
      symbol: p.symbol,
      data_symbol: null,
      side: p.type,
      size: p.volume,
      size_unit: "lots",
      entry_price: p.price_open,
      current_price: p.price_current,
      sl: p.sl || null,
      tp: p.tp || null,
      risk_amount: 0,
      pnl: p.profit,
      status: "open",
      broker_ref: p.ticket,
      magic: p.magic,
      external: !bot,
      close_reason: null,
      exit_price: null,
      opened_at: nowIso(),
      closed_at: null,
    };
    await store.trades.insert(trade);
  }

  // 4. Commands the EA received but never confirmed (e.g. terminal restarted mid-order).
  const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
  for (const c of await store.commands.all({ eq: { account_id: account.id, status: "sent" } })) {
    if (!c.sent_at || c.sent_at > staleBefore) continue;
    await store.commands.update(c.id, { status: "failed", result: { error: "No confirmation from the MT5 bridge" } });
    const trade = c.trade_id ? await store.trades.get(c.trade_id) : null;
    if (c.type === "open" && trade?.status === "pending") {
      await store.trades.update(trade.id, { status: "rejected", close_reason: "No confirmation from the MT5 bridge", closed_at: nowIso() });
    }
    await log("warn", `MT5 ${c.type} command was not confirmed by the bridge within 3 minutes`, { bot_id: trade?.bot_id });
  }

  // 5. Hand over queued commands.
  const queued = await store.commands.all({
    eq: { account_id: account.id, status: "queued" },
    order: { field: "created_at", ascending: true },
  });
  for (const c of queued) await store.commands.update(c.id, { status: "sent", sent_at: nowIso() });
  return queued.map(formatCommand).join("\n");
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/[|\n\r]/g, " ");
}

export function formatCommand(c: Mt5Command): string {
  const p = c.payload as Record<string, unknown>;
  return [c.id, c.type, p.symbol, p.side, p.risk_money, p.sl, p.tp, p.magic, p.ticket, p.comment].map(clean).join("|");
}
