"use client";

import { useDashboard } from "@/components/app/dashboard-context";
import { EmptyState, PageHeader, PageSkeleton, Panel, PositionsTable, TradeKindBadge } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money, pnlClass, price } from "@/lib/client";
import { cn } from "@/lib/utils";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function TradesPage() {
  const { state } = useDashboard();
  if (!state) return <PageSkeleton />;
  const bots = new Map(state.bots.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-5">
      <PageHeader title="Trades" description="Every position, fill and signal across your connected accounts." />
      <Tabs defaultValue="open">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="open">Open ({state.open_trades.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          <Panel>
            <PositionsTable trades={state.open_trades} showBook />
          </Panel>
        </TabsContent>

        <TabsContent value="history">
          <Panel>
            {state.closed_trades.length ? (
              <>
                <ul className="divide-y divide-white/5 md:hidden">
                  {state.closed_trades.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{t.symbol}</span>
                          <span className={cn("text-xs font-bold", t.side === "buy" ? "text-profit" : "text-loss")}>
                            {t.side.toUpperCase()}
                          </span>
                          <TradeKindBadge trade={t} />
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {(t.bot_id && bots.get(t.bot_id)) || (t.external ? "Other EA / manual" : "—")} · {when(t.closed_at)}
                        </div>
                        <div
                          className={cn("mt-0.5 truncate text-xs", t.status === "rejected" ? "text-loss" : "text-muted-foreground")}
                        >
                          {t.close_reason}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn("font-mono font-semibold tabular-nums", pnlClass(t.pnl))}>
                          {t.status === "rejected" ? "—" : money(t.pnl, "USD", true)}
                        </div>
                        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {price(t.entry_price)} → {price(t.exit_price)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="scrollbar-thin hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2 font-medium">Closed</th>
                        <th className="px-2 py-2 font-medium">Symbol</th>
                        <th className="px-2 py-2 font-medium">Side</th>
                        <th className="px-2 py-2 font-medium">Entry → Exit</th>
                        <th className="px-2 py-2 font-medium">Bot</th>
                        <th className="px-2 py-2 font-medium">Reason</th>
                        <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.closed_trades.map((t) => (
                        <tr key={t.id} className="border-t border-white/5">
                          <td className="px-2 py-2 text-muted-foreground">{when(t.closed_at)}</td>
                          <td className="px-2 py-2 font-semibold">
                            {t.symbol}{" "}
                            <TradeKindBadge trade={t} className="ml-1" />
                          </td>
                          <td className={cn("px-2 py-2", t.side === "buy" ? "text-profit" : "text-loss")}>
                            {t.side.toUpperCase()}
                          </td>
                          <td className="px-2 py-2 font-mono">
                            {price(t.entry_price)} → {price(t.exit_price)}
                          </td>
                          <td className="px-2 py-2">{(t.bot_id && bots.get(t.bot_id)) || (t.external ? "Other EA / manual" : "—")}</td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {t.status === "rejected" ? <span className="text-loss">{t.close_reason}</span> : t.close_reason}
                          </td>
                          <td className={cn("px-2 py-2 text-right font-mono", pnlClass(t.pnl))}>
                            {t.status === "rejected" ? "—" : money(t.pnl, "USD", true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <EmptyState>No closed trades yet.</EmptyState>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="signals">
          <Panel>
            {state.signals.length ? (
              <ul className="divide-y divide-white/5 text-sm">
                {state.signals.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                    <div>
                      <span className="font-semibold">{(s.bot_id && bots.get(s.bot_id)) ?? "Unknown bot"}</span>{" "}
                      <span className="text-muted-foreground">
                        · {s.source} · {s.action.toUpperCase()} {s.symbol}
                        {s.price ? ` @ ${price(s.price)}` : ""}
                      </span>
                      {s.reason && <div className="text-xs text-muted-foreground">{s.reason}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{when(s.received_at)}</span>
                      <Badge variant={s.status === "accepted" ? "profit" : s.status === "duplicate" ? "muted" : "loss"}>{s.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No signals received yet.</EmptyState>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
