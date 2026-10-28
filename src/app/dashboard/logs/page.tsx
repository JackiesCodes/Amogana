"use client";

import { useState } from "react";

import { useDashboard } from "@/components/app/dashboard-context";
import { EmptyState, PageHeader, Panel, Segmented } from "@/components/app/widgets";
import { cn } from "@/lib/utils";

const LEVELS = ["all", "trade", "warn", "error", "info"] as const;
const TONE: Record<string, string> = {
  trade: "text-profit",
  warn: "text-amber-300",
  error: "text-loss",
  info: "text-muted-foreground",
};

export default function LogsPage() {
  const { state } = useDashboard();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const logs = (state?.logs ?? []).filter((l) => level === "all" || l.level === level);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts & Logs"
        description="Everything the engine did and why — newest first."
        action={
          <Segmented
            value={level}
            onChange={setLevel}
            className="w-full sm:w-auto"
            options={LEVELS.map((l) => ({ value: l, label: l }))}
          />
        }
      />
      <Panel>
        {logs.length ? (
          <ul className="divide-y divide-white/5 font-mono text-xs">
            {logs.map((l) => (
              <li key={l.id} className="grid gap-x-3 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_3.5rem_1fr]">
                <span className="flex gap-3 text-muted-foreground sm:contents">
                  <span>{new Date(l.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })}</span>
                  <span className={cn("uppercase", TONE[l.level])}>{l.level}</span>
                </span>
                <span className="min-w-0 break-words font-sans text-[13px] sm:font-mono sm:text-xs">{l.message}</span>
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
