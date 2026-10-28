"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pause, Play, Plus, Trash2 } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { AccountKindBadge, BotStatusBadge, CopyRow, EmptyState, Field, PageHeader, PageSkeleton, Panel, selectClass } from "@/components/app/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, money, pnlClass, timeAgo } from "@/lib/client";
import { STRATEGIES, defaultParams, getStrategy } from "@/lib/strategies";
import { DATA_SYMBOLS, TIMEFRAMES, guessDataSymbol, timeframeLabel } from "@/lib/trading/symbols";
import type { PublicBroker } from "@/lib/trading/state";
import type { Bot } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

export default function BotsPage() {
  return (
    <Suspense>
      <BotsPageInner />
    </Suspense>
  );
}

function BotsPageInner() {
  const { state } = useDashboard();
  const params = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (params.get("new")) setCreating(true);
  }, [params]);

  const closeDialog = (open: boolean) => {
    setCreating(open);
    if (!open && params.get("new")) router.replace("/dashboard/bots");
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bots"
        description="Built-in bots trade a Strategy Lab strategy on their own. TradingView bots execute your Pine Script alerts."
        action={
          <Button onClick={() => setCreating(true)} className="w-full sm:w-auto">
            <Plus /> New bot
          </Button>
        }
      />

      {!state ? (
        <PageSkeleton />
      ) : state.bots.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {state.bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} brokers={state.brokers} />
          ))}
        </div>
      ) : (
        <EmptyState>
          No bots yet. A bot trades on the broker account you choose — use a demo account to practise before trading real money.
        </EmptyState>
      )}

      <Dialog open={creating} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-h-[90vh] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New bot</DialogTitle>
            <DialogDescription>
              The bot trades on the account you choose: a demo account uses your broker&apos;s demo money, a real account uses real money.
              It starts paused.
            </DialogDescription>
          </DialogHeader>
          {state &&
            (state.brokers.length ? (
              <BotForm brokers={state.brokers} onDone={() => closeDialog(false)} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Connect an Exness or Deriv account first — every bot trades on one of your accounts.</p>
                <Button asChild className="w-full">
                  <Link href="/dashboard/brokers">Connect a broker account</Link>
                </Button>
              </div>
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BotForm({ brokers, onDone }: { brokers: PublicBroker[]; onDone: () => void }) {
  const { refresh } = useDashboard();
  const params = useSearchParams();
  const presetStrategy = params.get("strategy");
  const presetParams = (() => {
    try {
      return JSON.parse(params.get("params") ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  })();

  const [source, setSource] = useState<"builtin" | "tradingview">(presetStrategy || !params.get("tv") ? "builtin" : "tradingview");
  const [name, setName] = useState("");
  const [brokerId, setBrokerId] = useState<string>(brokers[0]?.id ?? "");
  const broker = brokers.find((b) => b.id === brokerId);
  const [symbol, setSymbol] = useState(params.get("data_symbol") ?? "frxEURUSD");
  const [dataSymbol, setDataSymbol] = useState(params.get("data_symbol") ?? "frxEURUSD");
  const [timeframe, setTimeframe] = useState(Number(params.get("timeframe") ?? 3600));
  const [strategyId, setStrategyId] = useState(presetStrategy ?? STRATEGIES[0]!.id);
  const def = getStrategy(strategyId)!;
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({ ...defaultParams(def), ...presetParams });
  const [risk, setRisk] = useState(1);
  const [multiplier, setMultiplier] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMt5 = broker?.kind === "mt5";

  // MT5 brokers name symbols like "EURUSD"/"EURUSDm"; Deriv uses its own codes ("frxEURUSD").
  useEffect(() => {
    if (isMt5 && /^(frx|cry)/.test(symbol)) setSymbol(symbol.slice(3));
    if (!isMt5 && !DATA_SYMBOLS.some((d) => d.value === symbol)) setSymbol(dataSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMt5]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/bots", "POST", {
        name: name || `${source === "builtin" ? def.name : "TradingView"} · ${symbol}`,
        source,
        broker_account_id: brokerId,
        symbol,
        data_symbol: isMt5 ? dataSymbol : symbol,
        timeframe,
        strategy_id: source === "builtin" ? strategyId : undefined,
        strategy_params: source === "builtin" ? strategyParams : undefined,
        risk_percent: risk,
        deriv_multiplier: multiplier,
      });
      await refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1 text-sm font-semibold">
        {(
          [
            ["builtin", "Built-in strategy"],
            ["tradingview", "TradingView alerts"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setSource(value)}
            className={cn("rounded-lg py-2", source === value ? "bg-profit text-ink" : "text-muted-foreground")}
          >
            {label}
          </button>
        ))}
      </div>

      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EURUSD Trend Rider" />
      </Field>

      <Field
        label="Broker account"
        hint={
          broker
            ? broker.is_demo
              ? "Demo account — trades use your broker's demo money."
              : "Real account — trades use real money."
            : undefined
        }
      >
        <select className={selectClass} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} · {b.kind === "mt5" ? "MT5" : "Deriv"} · {b.is_demo ? "Demo" : "Real"}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {isMt5 ? (
          <>
            <Field label="MT5 symbol" hint="Exactly as in Market Watch, e.g. EURUSDm on Exness.">
              <Input
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setDataSymbol(guessDataSymbol(e.target.value));
                }}
              />
            </Field>
            <Field label="Price feed" hint="Market data the strategy reads its signals from.">
              <select className={selectClass} value={dataSymbol} onChange={(e) => setDataSymbol(e.target.value)}>
                {!DATA_SYMBOLS.some((d) => d.value === dataSymbol) && <option value={dataSymbol}>{dataSymbol}</option>}
                {DATA_SYMBOLS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Market">
            <select className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {DATA_SYMBOLS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label} ({d.group})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Timeframe">
          <select className={selectClass} value={timeframe} onChange={(e) => setTimeframe(Number(e.target.value))}>
            {TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {source === "builtin" && (
        <div className="space-y-3 rounded-xl border border-white/10 p-3">
          <Field label="Strategy" hint={def.description}>
            <select
              className={selectClass}
              value={strategyId}
              onChange={(e) => {
                setStrategyId(e.target.value);
                setStrategyParams(defaultParams(getStrategy(e.target.value)!));
              }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.style}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {def.params.map((p) => (
              <Field key={p.key} label={p.label}>
                <Input
                  type="number"
                  step="any"
                  value={strategyParams[p.key] ?? p.default}
                  onChange={(e) => setStrategyParams({ ...strategyParams, [p.key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Risk per trade (%)" hint="Loss if the stop is hit, as % of equity. 0.5–1% is sensible.">
          <Input type="number" step="0.1" min="0.1" max="5" value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
        </Field>
        {broker?.kind === "deriv" && (
          <Field label="Deriv multiplier" hint="Must be a value Deriv allows for this market.">
            <Input type="number" min="1" value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} />
          </Field>
        )}
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : broker?.is_demo === false ? "Create bot on real account" : "Create bot"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function BotCard({ bot, brokers }: { bot: Bot; brokers: PublicBroker[] }) {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const broker = brokers.find((b) => b.id === bot.broker_account_id);
  const trades = [...(state?.open_trades ?? []), ...(state?.closed_trades ?? [])].filter((t) => t.bot_id === bot.id && t.status !== "rejected");
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const open = trades.filter((t) => t.status === "open" || t.status === "pending");
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.pnl > 0).length;
  const strategy = bot.strategy ? getStrategy(bot.strategy.id) : undefined;

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (success) toast(success, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>, success?: string) => run(() => api(`/api/bots/${bot.id}`, "PATCH", body), success);

  const signal = async (action: "buy" | "sell" | "close") => {
    if (
      broker && !broker.is_demo &&
      !(await confirm({
        title: `Send a real-money ${action.toUpperCase()} order?`,
        description: `${bot.symbol} on ${broker?.label ?? "your broker"}. This uses real money and passes through Risk Guard first.`,
        confirmLabel: `${action === "close" ? "Close" : action === "buy" ? "Buy" : "Sell"} now`,
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await res.json()) as { status?: string; reason?: string | null };
      await refresh();
      if (result.status === "accepted") toast(action === "close" ? "Close order sent" : `${action.toUpperCase()} order sent`, "success");
      else toast(result.reason ?? "Order rejected", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${bot.name}"?`,
      description: "Its open trades will be closed. This can't be undone.",
      confirmLabel: "Delete bot",
      danger: true,
    });
    if (ok) await run(() => api(`/api/bots/${bot.id}`, "DELETE"), "Bot deleted");
  };

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{bot.name}</h3>
            <AccountKindBadge broker={broker} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {bot.source === "tradingview" ? "TradingView alerts" : strategy?.name ?? "Built-in"} · {bot.symbol} · {timeframeLabel(bot.timeframe)} ·{" "}
            {broker ? broker.label : "no broker"} · risk {bot.risk_percent}%
            {broker?.kind === "mt5" && ` · magic ${bot.magic}`}
          </p>
          {bot.status === "paused" && bot.paused_reason && <p className="mt-1 text-xs text-amber-300">{bot.paused_reason}</p>}
        </div>
        <BotStatusBadge bot={bot} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat label="P&L" value={money(pnl, "USD", true)} className={pnlClass(pnl)} />
        <Stat label="Open" value={String(open.length)} />
        <Stat label="Closed" value={String(closed.length)} />
        <Stat label="Win rate" value={closed.length ? `${Math.round((wins / closed.length) * 100)}%` : "—"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {bot.status === "running" ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ status: "paused" }, "Bot paused")} className="col-span-2 sm:col-span-1">
            <Pause /> Pause
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => patch({ status: "running" }, "Bot started")} className="col-span-2 sm:col-span-1">
            <Play /> Start
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => signal("buy")} className="text-profit">
          Buy
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => signal("sell")} className="text-loss">
          Sell
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !open.length} onClick={() => signal("close")} className="col-span-2 sm:col-span-1">
          Close position
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {bot.source === "tradingview" && (
          <Button size="sm" variant="ghost" onClick={() => setShowWebhook((v) => !v)}>
            {showWebhook ? "Hide setup" : "TradingView setup"}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-loss" disabled={busy} onClick={remove} aria-label="Delete bot">
          <Trash2 />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 pt-3 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          Risk %
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="5"
            defaultValue={bot.risk_percent}
            onBlur={(e) => Number(e.target.value) !== bot.risk_percent && patch({ risk_percent: Number(e.target.value) }, "Risk updated")}
            className="h-8 w-16 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-base text-foreground sm:text-xs"
          />
        </label>
        <label className="flex items-center gap-2">
          Account
          <select
            value={bot.broker_account_id ?? ""}
            onChange={(e) => patch({ broker_account_id: e.target.value }, "Account updated")}
            disabled={busy || open.length > 0}
            title={open.length ? "Close this bot's positions before changing account" : undefined}
            className="h-8 max-w-[16rem] rounded-lg border border-white/10 bg-white/[0.03] px-2 text-base text-foreground sm:text-xs [&>option]:bg-ink"
          >
            {!bot.broker_account_id && <option value="">Choose account…</option>}
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · {b.is_demo ? "Demo" : "Real"}
              </option>
            ))}
          </select>
        </label>
        <span>Last signal {timeAgo(bot.last_signal_at)}</span>
      </div>

      {showWebhook && <WebhookSetup bot={bot} />}
    </Panel>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-2 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono text-sm", className)}>{value}</div>
    </div>
  );
}

function WebhookSetup({ bot }: { bot: Bot }) {
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/api/webhooks/tradingview`;
  const message = JSON.stringify(
    {
      bot_id: bot.id,
      passphrase: bot.webhook_passphrase,
      action: "{{strategy.order.action}}",
      price: "{{close}}",
      id: "{{timenow}}",
    },
    null,
    0,
  ).replace('"{{close}}"', "{{close}}");

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-profit/20 bg-profit/[0.04] p-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>In TradingView, open your strategy → <b className="text-foreground">Create alert</b>.</li>
        <li>
          Under <b className="text-foreground">Notifications</b>, tick <b className="text-foreground">Webhook URL</b> and paste the URL below.
        </li>
        <li>Paste the message below into the alert&apos;s <b className="text-foreground">Message</b> box and save.</li>
        <li>
          For indicator alerts (not strategies), replace <code>{"{{strategy.order.action}}"}</code> with <code>buy</code>, <code>sell</code> or{" "}
          <code>close</code>. You can add <code>&quot;sl&quot;</code> and <code>&quot;tp&quot;</code> prices too.
        </li>
      </ol>
      <CopyRow label="Webhook URL" value={url} />
      <CopyRow label="Alert message" value={message} />
      <p className="text-xs text-muted-foreground">Keep the passphrase private — anyone with it can send signals to this bot.</p>
    </div>
  );
}
