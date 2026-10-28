"use client";

import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Trophy } from "lucide-react";

import { AreaChart, EmptyState, Field, Kpi, PageHeader, Panel, selectClass } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, pct, pnlClass, price } from "@/lib/client";
import { STRATEGIES, defaultParams, getStrategy } from "@/lib/strategies";
import type { BacktestMetrics, BacktestResult, OptimiseEntry } from "@/lib/strategies/backtest";
import { DATA_SYMBOLS, TIMEFRAMES, timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

interface Range {
  from: number;
  to: number;
  bars: number;
}

function dateRange(r: Range) {
  const d = (s: number) => new Date(s * 1000).toLocaleDateString();
  return `${d(r.from)} → ${d(r.to)} · ${r.bars} candles`;
}

function deployHref(strategyId: string, params: Record<string, number>, dataSymbol: string, timeframe: number) {
  const q = new URLSearchParams({
    new: "1",
    strategy: strategyId,
    params: JSON.stringify(params),
    data_symbol: dataSymbol,
    timeframe: String(timeframe),
  });
  return `/dashboard/bots?${q}`;
}

export default function StrategyLabPage() {
  const [dataSymbol, setDataSymbol] = useState("frxEURUSD");
  const [timeframe, setTimeframe] = useState(3600);
  const [risk, setRisk] = useState(1);
  const [cost, setCost] = useState(0.02);
  const [strategyId, setStrategyId] = useState(STRATEGIES[0]!.id);
  const [params, setParams] = useState<Record<string, number>>(defaultParams(STRATEGIES[0]!));
  const [busy, setBusy] = useState<"optimise" | "backtest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<{ range: Range; leaderboard: OptimiseEntry[] } | null>(null);
  const [selected, setSelected] = useState(0);
  const [single, setSingle] = useState<(BacktestResult & { range: Range }) | null>(null);
  const def = getStrategy(strategyId)!;

  const common = { data_symbol: dataSymbol, timeframe, risk_percent: risk, cost_percent: cost };

  const run = async (action: "optimise" | "backtest") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "optimise") {
        const res = await api<{ range: Range; leaderboard: OptimiseEntry[] }>("/api/strategy-lab", "POST", { action, ...common });
        setBoard(res);
        setSelected(0);
      } else {
        setSingle(
          await api<BacktestResult & { range: Range }>("/api/strategy-lab", "POST", { action, ...common, strategy_id: strategyId, params }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pick = board?.leaderboard[selected];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Strategy Lab"
        description="Test strategies on real Deriv price history, then let the optimiser “train” them: it tunes each one on the first 70% of the data and judges it only on the last 30% it has never seen."
      />

      <Panel>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Field label="Market">
            <select className={selectClass} value={dataSymbol} onChange={(e) => setDataSymbol(e.target.value)}>
              {DATA_SYMBOLS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Timeframe">
            <select className={selectClass} value={timeframe} onChange={(e) => setTimeframe(Number(e.target.value))}>
              {TIMEFRAMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Risk per trade (%)">
            <Input type="number" step="0.1" value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
          </Field>
          <Field label="Cost / trade (%)" hint="Spread + fees. 0.02% ≈ 2 pips on EURUSD.">
            <Input type="number" step="0.005" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => run("optimise")} disabled={busy !== null} className="w-full sm:w-auto">
            <Trophy /> {busy === "optimise" ? "Training on history…" : "Find the best strategy"}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-loss">{error}</p>}
      </Panel>

      {board && (
        <Panel
          title={`Leaderboard — ${DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol} ${timeframeLabel(timeframe)}`}
          action={<span className="text-xs text-muted-foreground">{dateRange(board.range)}</span>}
        >
          <ol className="space-y-2 md:hidden">
            {board.leaderboard.map((e, i) => {
              const m = e.out_of_sample;
              return (
                <li
                  key={e.strategy_id}
                  onClick={() => setSelected(i)}
                  className={cn(
                    "rounded-xl border p-3",
                    i === selected ? "border-profit/40 bg-profit/[0.04]" : "border-white/[0.06] bg-white/[0.02]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        <span className="mr-1.5 font-mono text-muted-foreground">#{i + 1}</span>
                        {e.strategy_name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {Object.entries(e.params)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("font-mono text-lg font-semibold tabular-nums", pnlClass(m.return_percent))}>
                        {pct(m.return_percent, 1, true)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">unseen data</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-center font-mono text-xs tabular-nums">
                    {[
                      ["Train", pct(e.in_sample.return_percent, 0, true)],
                      ["Max DD", pct(-m.max_drawdown_percent, 1)],
                      ["Win", pct(m.win_rate, 0)],
                      ["Trades", String(m.trades)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-white/[0.03] py-1.5">
                        <div className="font-sans text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
                        {value}
                      </div>
                    ))}
                  </div>
                  {!Number.isFinite(e.oos_score) && <p className="mt-2 text-[11px] text-amber-300">Too few trades to trust this result.</p>}
                  <Button size="sm" variant={i === 0 ? "default" : "outline"} className="mt-3 w-full" asChild>
                    <Link href={deployHref(e.strategy_id, e.params, dataSymbol, timeframe)}>Deploy as paper bot</Link>
                  </Button>
                </li>
              );
            })}
          </ol>
          <div className="scrollbar-thin hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Strategy</th>
                  <th className="px-2 py-2 font-medium">Training return</th>
                  <th className="px-2 py-2 font-medium">Unseen-data return</th>
                  <th className="px-2 py-2 font-medium">Max DD</th>
                  <th className="px-2 py-2 font-medium">Win rate</th>
                  <th className="px-2 py-2 font-medium">Profit factor</th>
                  <th className="px-2 py-2 font-medium">Trades</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {board.leaderboard.map((e, i) => {
                  const m = e.out_of_sample;
                  const trusted = Number.isFinite(e.oos_score);
                  return (
                    <tr
                      key={e.strategy_id}
                      onClick={() => setSelected(i)}
                      className={cn("cursor-pointer border-t border-white/5", i === selected && "bg-white/[0.04]")}
                    >
                      <td className="px-2 py-2.5 font-mono">{i + 1}</td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold">{e.strategy_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {Object.entries(e.params)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(" · ")}
                        </div>
                      </td>
                      <td className={cn("px-2 py-2.5 font-mono", pnlClass(e.in_sample.return_percent))}>
                        {pct(e.in_sample.return_percent, 1, true)}
                      </td>
                      <td className={cn("px-2 py-2.5 font-mono font-semibold", pnlClass(m.return_percent))}>
                        {pct(m.return_percent, 1, true)}
                      </td>
                      <td className="px-2 py-2.5 font-mono">{pct(-m.max_drawdown_percent)}</td>
                      <td className="px-2 py-2.5 font-mono">{pct(m.win_rate, 0)}</td>
                      <td className="px-2 py-2.5 font-mono">{m.profit_factor === null ? "∞" : m.profit_factor.toFixed(2)}</td>
                      <td className="px-2 py-2.5 font-mono">
                        {m.trades}{" "}
                        {!trusted && (
                          <Badge variant="warning" className="ml-1">
                            too few
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <Button size="sm" variant={i === 0 ? "default" : "outline"} asChild>
                          <Link href={deployHref(e.strategy_id, e.params, dataSymbol, timeframe)}>Deploy (paper)</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pick && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted-foreground">{pick.strategy_name} on unseen data</div>
              <AreaChart points={pick.equity.map((p) => ({ x: p.epoch, y: p.equity }))} baseline={10000} height={180} />
            </div>
          )}
          <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200">
            Read this before deploying: the “unseen-data” column is the honest number — training returns are always flattering. Even
            unseen-data results can fade live (spreads, slippage, changing markets). No strategy can promise 100% ROI. Paper trade for 2–4
            weeks, and only go live with small risk if live results look like these.
          </p>
        </Panel>
      )}

      <Panel
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Backtest a single strategy
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <Field label="Strategy" hint={def.style}>
              <select
                className={selectClass}
                value={strategyId}
                onChange={(e) => {
                  setStrategyId(e.target.value);
                  setParams(defaultParams(getStrategy(e.target.value)!));
                }}
              >
                {STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {def.params.map((p) => (
            <Field key={p.key} label={p.label}>
              <Input
                type="number"
                step="any"
                value={params[p.key] ?? p.default}
                onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
              />
            </Field>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{def.description}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => run("backtest")} disabled={busy !== null} className="w-full sm:w-auto">
            {busy === "backtest" ? "Running…" : "Run backtest"}
          </Button>
          {single && (
            <Button variant="ghost" asChild>
              <Link href={deployHref(strategyId, params, dataSymbol, timeframe)}>Deploy as paper bot →</Link>
            </Button>
          )}
        </div>

        {single && (
          <div className="mt-5 space-y-4">
            <div className="text-xs text-muted-foreground">{dateRange(single.range)}</div>
            <MetricsGrid m={single.metrics} />
            <AreaChart points={single.equity.map((p) => ({ x: p.epoch, y: p.equity }))} baseline={10000} />
            {single.trades.length ? (
              <div className="scrollbar-thin max-h-72 overflow-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Opened</th>
                      <th className="px-2 py-1.5 font-medium">Side</th>
                      <th className="px-2 py-1.5 font-medium">Entry → Exit</th>
                      <th className="px-2 py-1.5 font-medium">Exit reason</th>
                      <th className="px-2 py-1.5 text-right font-medium">R</th>
                      <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...single.trades].reverse().map((t, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="px-2 py-1.5">{new Date(t.entry_epoch * 1000).toLocaleString()}</td>
                        <td className={cn("px-2 py-1.5", t.side === "buy" ? "text-profit" : "text-loss")}>
                          {t.side.toUpperCase()}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {price(t.entry)} → {price(t.exit)}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{t.reason}</td>
                        <td className={cn("px-2 py-1.5 text-right font-mono", pnlClass(t.r_multiple))}>{t.r_multiple.toFixed(2)}</td>
                        <td className={cn("px-2 py-1.5 text-right font-mono", pnlClass(t.pnl))}>{money(t.pnl, "USD", true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState>No trades in this period.</EmptyState>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function MetricsGrid({ m }: { m: BacktestMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi
        label="Return"
        value={pct(m.return_percent, 1, true)}
        tone={pnlClass(m.return_percent)}
        sub={`Buy & hold ${pct(m.buy_hold_percent, 1, true)}`}
      />
      <Kpi label="Max drawdown" value={pct(-m.max_drawdown_percent)} />
      <Kpi label="Win rate" value={pct(m.win_rate, 0)} sub={`${m.trades} trades · avg ${m.avg_r.toFixed(2)}R`} />
      <Kpi
        label="Profit factor"
        value={m.profit_factor === null ? "∞" : m.profit_factor.toFixed(2)}
        sub={`Sharpe ${m.sharpe.toFixed(2)}`}
      />
    </div>
  );
}
