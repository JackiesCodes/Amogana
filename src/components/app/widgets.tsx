"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, money, pnlClass, price, timeAgo } from "@/lib/client";
import type { PublicBroker } from "@/lib/trading/state";
import type { Bot, Trade } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  action,
  className,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("glass-panel min-w-0 p-4 sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-liquid-platinum">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="glass-panel p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 font-mono text-xl font-semibold sm:text-2xl", tone)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Meter({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const color = ratio >= 0.9 ? "bg-neon-crimson" : ratio >= 0.6 ? "bg-amber-400" : "bg-cyber-mint";
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap font-mono">{display}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

/** Simple responsive SVG area chart. */
export function AreaChart({
  points,
  height = 220,
  baseline,
}: {
  points: Array<{ x: number; y: number }>;
  height?: number;
  baseline?: number;
}) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Not enough data yet — the curve fills in as the engine runs.
      </div>
    );
  }
  const W = 800;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...ys, baseline ?? Infinity);
  let maxY = Math.max(...ys, baseline ?? -Infinity);
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const pad = (maxY - minY) * 0.08;
  minY -= pad;
  maxY += pad;
  const sx = (x: number) => ((x - minX) / (maxX - minX || 1)) * W;
  const sy = (y: number) => height - ((y - minY) / (maxY - minY)) * height;
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const up = points[points.length - 1]!.y >= points[0]!.y;
  const stroke = up ? "#00FFA3" : "#FF2E93";
  const id = up ? "area-up" : "area-down";

  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Equity curve">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.3" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.05)" />
      ))}
      {baseline !== undefined && (
        <line x1="0" x2={W} y1={sy(baseline)} y2={sy(baseline)} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
      )}
      <path d={`${line} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BotStatusBadge({ bot }: { bot: Bot }) {
  if (bot.status === "running") {
    return (
      <Badge variant="mint">
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> Running
      </Badge>
    );
  }
  return (
    <Badge variant="amber" title={bot.paused_reason ?? undefined}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> Paused
    </Badge>
  );
}

export function BrokerStatusBadge({ broker }: { broker: PublicBroker }) {
  if (broker.status === "connected") return <Badge variant="mint">● Connected</Badge>;
  if (broker.status === "waiting") return <Badge variant="amber">● Waiting for bridge</Badge>;
  return <Badge variant="crimson">● Error</Badge>;
}

export function PositionsTable({ trades, showBook = false }: { trades: Trade[]; showBook?: boolean }) {
  const { state, refresh } = useDashboard();
  const [closing, setClosing] = useState<string | null>(null);
  const bots = new Map(state?.bots.map((b) => [b.id, b]));
  const brokers = new Map(state?.brokers.map((b) => [b.id, b]));

  const close = async (trade: Trade) => {
    if (!window.confirm(`Close ${trade.side.toUpperCase()} ${trade.symbol}?`)) return;
    setClosing(trade.id);
    try {
      await api(`/api/trades/${trade.id}/close`, "POST");
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setClosing(null);
    }
  };

  if (!trades.length) return <EmptyState>No open positions.</EmptyState>;

  return (
    <div className="scrollbar-thin -mx-1 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-2 py-2 font-medium">Symbol</th>
            <th className="px-2 py-2 font-medium">Side</th>
            <th className="px-2 py-2 font-medium">Size</th>
            <th className="px-2 py-2 font-medium">Entry</th>
            <th className="px-2 py-2 font-medium">SL / TP</th>
            <th className="px-2 py-2 font-medium">Bot</th>
            <th className="px-2 py-2 font-medium">Account</th>
            <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const bot = t.bot_id ? bots.get(t.bot_id) : undefined;
            const broker = t.broker_account_id ? brokers.get(t.broker_account_id) : undefined;
            return (
              <tr key={t.id} className="border-t border-white/5">
                <td className="px-2 py-2.5 font-semibold">{t.symbol}</td>
                <td className={cn("px-2 py-2.5 font-medium", t.side === "buy" ? "text-cyber-mint" : "text-neon-crimson")}>
                  {t.side.toUpperCase()}
                </td>
                <td className="px-2 py-2.5 font-mono">
                  {t.status === "pending" ? (
                    <span className="text-amber-300">pending</span>
                  ) : t.size_unit === "stake" ? (
                    money(t.size)
                  ) : t.size_unit === "lots" ? (
                    `${t.size} lots`
                  ) : (
                    t.size.toFixed(2)
                  )}
                </td>
                <td className="px-2 py-2.5 font-mono">{price(t.entry_price)}</td>
                <td className="px-2 py-2.5 font-mono text-muted-foreground">
                  {price(t.sl)} / {price(t.tp)}
                </td>
                <td className="px-2 py-2.5">{bot?.name ?? (t.external ? <span className="text-muted-foreground">Other EA / manual{t.magic ? ` #${t.magic}` : ""}</span> : "—")}</td>
                <td className="px-2 py-2.5 text-muted-foreground">
                  {t.book === "paper" ? "Paper" : broker?.label ?? "—"}
                  {showBook && t.book === "live" && <Badge variant="crimson" className="ml-2">LIVE</Badge>}
                </td>
                <td className={cn("px-2 py-2.5 text-right font-mono", pnlClass(t.pnl))}>{money(t.pnl, broker?.currency, true)}</td>
                <td className="px-2 py-2.5 text-right">
                  <Button variant="outline" size="sm" onClick={() => close(t)} disabled={closing === t.id || Boolean(t.close_reason)}>
                    {t.close_reason ? "Closing…" : "Close"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const selectClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground focus:border-cyber-mint/50 focus:outline-none [&>option]:bg-obsidian [&>optgroup]:bg-obsidian";

export function LastSeen({ iso }: { iso: string | null }) {
  return <span className="text-xs text-muted-foreground">{timeAgo(iso)}</span>;
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-xs">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
