"use client";

import { useDashboard } from "@/components/app/dashboard-context";
import { EmptyState, Panel, PositionsTable } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money, pnlClass, price } from "@/lib/client";
import { cn } from "@/lib/utils";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export default function TradesPage() {
  const { state } = useDashboard();
  if (!state) return null;
  const bots = new Map(state.bots.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-liquid-platinum">Trades</h1>
        <p className="text-sm text-muted-foreground">Every position, fill and signal across paper and live accounts.</p>
      </div>
      <Tabs defaultValue="open">
        <TabsList>
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
              <div className="scrollbar-thin overflow-x-auto">
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
                          {t.symbol} {t.book === "live" ? <Badge variant="crimson" className="ml-1">LIVE</Badge> : <Badge variant="muted" className="ml-1">PAPER</Badge>}
                        </td>
                        <td className={cn("px-2 py-2", t.side === "buy" ? "text-cyber-mint" : "text-neon-crimson")}>{t.side.toUpperCase()}</td>
                        <td className="px-2 py-2 font-mono">
                          {price(t.entry_price)} → {price(t.exit_price)}
                        </td>
                        <td className="px-2 py-2">{(t.bot_id && bots.get(t.bot_id)) || (t.external ? "Other EA / manual" : "—")}</td>
                        <td className="px-2 py-2 text-muted-foreground">{t.status === "rejected" ? <span className="text-neon-crimson">{t.close_reason}</span> : t.close_reason}</td>
                        <td className={cn("px-2 py-2 text-right font-mono", pnlClass(t.pnl))}>{t.status === "rejected" ? "—" : money(t.pnl, "USD", true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
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
                      <Badge variant={s.status === "accepted" ? "mint" : s.status === "duplicate" ? "muted" : "crimson"}>{s.status}</Badge>
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
