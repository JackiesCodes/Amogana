"use client";

import { useState } from "react";

import { useDashboard } from "@/components/app/dashboard-context";
import { EmptyState, Panel } from "@/components/app/widgets";
import { cn } from "@/lib/utils";

const LEVELS = ["all", "trade", "warn", "error", "info"] as const;
const TONE: Record<string, string> = {
  trade: "text-cyber-mint",
  warn: "text-amber-300",
  error: "text-neon-crimson",
  info: "text-muted-foreground",
};

export default function LogsPage() {
  const { state } = useDashboard();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const logs = (state?.logs ?? []).filter((l) => level === "all" || l.level === level);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-liquid-platinum">Alerts &amp; Logs</h1>
          <p className="text-sm text-muted-foreground">Everything the engine did and why — newest first.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-white/[0.05] p-1 text-xs font-semibold">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={cn("rounded-lg px-3 py-1.5 capitalize", level === l ? "bg-cyber-mint text-obsidian" : "text-muted-foreground")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Panel>
        {logs.length ? (
          <ul className="divide-y divide-white/5 font-mono text-xs">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-3 py-2">
                <span className="shrink-0 text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                <span className={cn("w-12 shrink-0 uppercase", TONE[l.level])}>{l.level}</span>
                <span className="min-w-0 break-words">{l.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>Nothing logged yet.</EmptyState>
        )}
      </Panel>
    </div>
  );
}
