"use client";

import { useEffect, useState } from "react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { Field, Meter, PageHeader, PageSkeleton, Panel } from "@/components/app/widgets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money } from "@/lib/client";

const FIELDS = [
  { key: "daily_loss_limit", label: "Daily loss limit ($)", hint: "When today's loss reaches this, every bot in that mode (paper or live) pauses until you restart it." },
  { key: "max_drawdown_percent", label: "Max drawdown (%)", hint: "Drop from the equity peak that triggers the kill switch: all bots pause and all positions close." },
  { key: "max_open_trades", label: "Max open trades", hint: "Across all bots in one mode." },
  { key: "max_trades_per_bot", label: "Max trades per bot", hint: "1 = a bot holds at most one position at a time." },
  { key: "default_risk_percent", label: "Default risk per trade (%)", hint: "Used when a bot doesn't set its own. Hard-capped at 5%." },
  { key: "paper_starting_balance", label: "Paper starting balance ($)", hint: "Virtual money for paper trading." },
] as const;

type Key = (typeof FIELDS)[number]["key"];

export default function RiskPage() {
  const { state, refresh } = useDashboard();
  const { toast } = useFeedback();
  const [form, setForm] = useState<Record<Key, number> | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state && !form) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, state.settings[f.key]])) as Record<Key, number>);
  }, [state, form]);

  if (!state || !form) return <PageSkeleton />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings", "PATCH", form);
      await refresh();
      setSaved(true);
      toast("Risk limits saved", "success");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Risk Guard"
        description="Hard limits checked before every order. These protect you from the one thing that ends trading careers: a bad day turning into a blown account."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {(["live", "paper"] as const).map((book) => {
          const k = state.kpis[book];
          const loss = Math.max(0, -k.today_pnl);
          return (
            <Panel key={book} title={book === "live" ? "Live accounts" : "Paper account"}>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Equity <span className="font-mono text-foreground">{money(k.equity)}</span> · peak{" "}
                  <span className="font-mono text-foreground">{money(state.settings.books[book].peak_equity)}</span>
                </div>
                <Meter label="Daily loss" value={loss} max={state.settings.daily_loss_limit} display={`${money(loss)} / ${money(state.settings.daily_loss_limit)}`} />
                <Meter label="Drawdown" value={k.drawdown_percent} max={state.settings.max_drawdown_percent} display={`${k.drawdown_percent.toFixed(1)}% / ${state.settings.max_drawdown_percent}%`} />
                <Meter label="Open trades" value={k.open_positions} max={state.settings.max_open_trades} display={`${k.open_positions} / ${state.settings.max_open_trades}`} />
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Limits">
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Input type="number" step="any" value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {saved ? "Saved ✓" : busy ? "Saving…" : "Save limits"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
