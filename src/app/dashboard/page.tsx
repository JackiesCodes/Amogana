"use client";

import Link from "next/link";

import { useDashboard } from "@/components/app/dashboard-context";
import {
  AreaChart,
  BotStatusBadge,
  BrokerStatusBadge,
  EmptyState,
  Kpi,
  Meter,
  PageHeader,
  PageSkeleton,
  Panel,
  PositionsTable,
  Segmented,
} from "@/components/app/widgets";
import { money, pct, pnlClass } from "@/lib/client";
import { timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const { state, error, view, setView } = useDashboard();

  if (!state) {
    return error ? <div className="py-20 text-center text-muted-foreground">{error}</div> : <PageSkeleton />;
  }

  const k = state.kpis[view];
  const settings = state.settings;
  const bots = state.bots.filter((b) => b.book === view);
  const trades = state.open_trades.filter((t) => t.book === view);
  const curve = state.equity[view].map((p) => ({ x: Date.parse(p.created_at), y: p.equity }));
  const pnlByBot = new Map<string, number>();
  for (const t of [...state.open_trades, ...state.closed_trades]) {
    if (t.bot_id && t.status !== "rejected") pnlByBot.set(t.bot_id, (pnlByBot.get(t.bot_id) ?? 0) + t.pnl);
  }
  const dayLoss = Math.max(0, -k.today_pnl);
  const connected = state.brokers.filter((b) => b.status === "connected").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={view === "paper" ? "Paper trading — simulated money on live prices." : "Live trading — real money on your connected accounts."}
        action={
          <Segmented
            value={view}
            onChange={setView}
            className="w-full sm:w-auto"
            options={[
              { value: "paper", label: "Paper" },
              { value: "live", label: "Live", activeClass: "bg-neon-crimson text-white" },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          className="col-span-2 lg:col-span-1"
          label={view === "paper" ? "Paper equity" : "Total equity"}
          value={money(k.equity)} sub={view === "live" ? `${connected} connected account${connected === 1 ? "" : "s"}` : `Started at ${money(settings.paper_starting_balance)}`} />
        <Kpi label="Today P&L" value={money(k.today_pnl, "USD", true)} tone={pnlClass(k.today_pnl)} sub="Since 00:00 UTC" />
        <Kpi label="Open positions" value={String(k.open_positions)} sub={`Limit ${settings.max_open_trades}`} />
        <Kpi
          label="Win rate (30d)"
          value={pct(k.win_rate_30d)}
          sub={k.closed_30d ? `${k.closed_30d} trades · PF ${k.profit_factor_30d?.toFixed(2) ?? "∞"}` : "No closed trades yet"}
        />
        <Kpi
          label="Drawdown"
          value={pct(-k.drawdown_percent)}
          tone={k.drawdown_percent > settings.max_drawdown_percent * 0.6 ? "text-amber-300" : undefined}
          sub={`Kill switch at -${settings.max_drawdown_percent}%`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Panel title="Equity curve (30 days)">
          <AreaChart points={curve} baseline={view === "paper" ? settings.paper_starting_balance : undefined} />
        </Panel>
        <Panel title="My bots" action={<Link href="/dashboard/bots" className="text-xs text-muted-foreground hover:text-cyber-mint">Manage →</Link>}>
          {bots.length ? (
            <ul className="divide-y divide-white/5">
              {bots.slice(0, 6).map((bot) => {
                const pnl = pnlByBot.get(bot.id) ?? 0;
                const broker = state.brokers.find((b) => b.id === bot.broker_account_id);
                return (
                  <li key={bot.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{bot.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {bot.source === "tradingview" ? "TradingView" : "Built-in"} · {bot.symbol} · {timeframeLabel(bot.timeframe)}
                        {view === "live" && broker ? ` · ${broker.label}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <BotStatusBadge bot={bot} />
                      <div className={cn("mt-1 font-mono text-xs", pnlClass(pnl))}>{money(pnl, "USD", true)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>
              No {view} bots yet. <Link href="/dashboard/bots?new=1" className="text-cyber-mint">Create one →</Link>
            </EmptyState>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[1.7fr_0.8fr_0.8fr]">
        <Panel title="Open positions" className="md:col-span-2 2xl:col-span-1">
          <PositionsTable trades={trades} />
        </Panel>
        <Panel title="Brokers" action={<Link href="/dashboard/brokers" className="text-xs text-muted-foreground hover:text-cyber-mint">Manage →</Link>}>
          {state.brokers.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {state.brokers.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate">{b.label}</div>
                    <div className="text-xs text-muted-foreground">{b.status === "connected" ? money(b.equity, b.currency) : b.error ?? "Not connected"}</div>
                  </div>
                  <BrokerStatusBadge broker={b} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>
              <Link href="/dashboard/brokers" className="text-cyber-mint">Connect Exness or Deriv →</Link>
            </EmptyState>
          )}
        </Panel>
        <Panel title="Risk Guard" action={<Link href="/dashboard/risk" className="text-xs text-muted-foreground hover:text-cyber-mint">Edit →</Link>}>
          <div className="space-y-4">
            <Meter label="Daily loss" value={dayLoss} max={settings.daily_loss_limit} display={`${money(dayLoss)} / ${money(settings.daily_loss_limit)}`} />
            <Meter label="Drawdown" value={k.drawdown_percent} max={settings.max_drawdown_percent} display={`${k.drawdown_percent.toFixed(1)}% / ${settings.max_drawdown_percent}%`} />
            <Meter label="Open trades" value={k.open_positions} max={settings.max_open_trades} display={`${k.open_positions} / ${settings.max_open_trades}`} />
            <p className="text-xs text-muted-foreground">Every order is checked here before it reaches a broker. Bots pause automatically when a limit is hit.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
