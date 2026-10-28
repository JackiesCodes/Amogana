"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {title && <h2 className="text-sm font-semibold tracking-wide text-ivory">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ivory sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn("glass-panel min-w-0 p-3.5 sm:p-4", className)}>
      <div className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:text-[11px]">{label}</div>
      <div className={cn("mt-1 truncate font-mono text-lg font-semibold tabular-nums sm:mt-1.5 sm:text-2xl", tone)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground sm:mt-1 sm:text-xs">{sub}</div>}
    </div>
  );
}

/** Placeholder blocks shown while the first state load is in flight. */
export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={cn("h-24 animate-pulse rounded-2xl bg-white/[0.04]", i === 0 && "col-span-2 lg:col-span-1")} />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-white/[0.04]" />
      <div className="h-48 animate-pulse rounded-2xl bg-white/[0.04]" />
    </div>
  );
}

/** Segmented control (Real / Demo accounts, filters…). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; activeClass?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-xl bg-white/[0.05] p-1 text-xs font-semibold sm:text-sm", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 capitalize transition-colors sm:px-4",
            value === o.value ? o.activeClass ?? "bg-profit text-ink" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Meter({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const color = ratio >= 0.9 ? "bg-loss" : ratio >= 0.6 ? "bg-amber-400" : "bg-profit";
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
  const stroke = up ? "#85BB65" : "#D9634F";
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
      <Badge variant="profit">
        <span className="h-1.5 w-1.5 rounded-full bg-current" /> Running
      </Badge>
    );
  }
  return (
    <Badge variant="warning" title={bot.paused_reason ?? undefined}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> Paused
    </Badge>
  );
}

/** REAL (gold) or DEMO, straight from the broker account. */
export function AccountKindBadge({ broker, className }: { broker: Pick<PublicBroker, "is_demo"> | null | undefined; className?: string }) {
  if (!broker) return <Badge variant="warning" className={className}>NO ACCOUNT</Badge>;
  return broker.is_demo ? (
    <Badge variant="default" className={className}>DEMO</Badge>
  ) : (
    <Badge variant="gold" className={className}>REAL</Badge>
  );
}

/** REAL / DEMO as recorded on the trade (the account's kind when it was opened). */
export function TradeKindBadge({ trade, className }: { trade: Pick<Trade, "book">; className?: string }) {
  return <AccountKindBadge broker={{ is_demo: trade.book === "demo" }} className={className} />;
}

export function BrokerStatusBadge({ broker }: { broker: PublicBroker }) {
  if (broker.status === "connected") return <Badge variant="profit">● Connected</Badge>;
  if (broker.status === "waiting") return <Badge variant="warning">● Waiting for bridge</Badge>;
  return <Badge variant="loss">● Error</Badge>;
}

export function PositionsTable({ trades, showBook = false }: { trades: Trade[]; showBook?: boolean }) {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [closing, setClosing] = useState<string | null>(null);
  const bots = new Map(state?.bots.map((b) => [b.id, b]));
  const brokers = new Map(state?.brokers.map((b) => [b.id, b]));

  const close = async (trade: Trade) => {
    const ok = await confirm({
      title: `Close ${trade.side.toUpperCase()} ${trade.symbol}?`,
      description:
        trade.book === "real"
          ? "This closes a real-money position at the current market price."
          : "Closes this demo-account position at the current market price.",
      confirmLabel: "Close position",
      danger: trade.book === "real",
    });
    if (!ok) return;
    setClosing(trade.id);
    try {
      await api(`/api/trades/${trade.id}/close`, "POST");
      await refresh();
      toast(`${trade.symbol} close sent`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setClosing(null);
    }
  };

  if (!trades.length) return <EmptyState>No open positions.</EmptyState>;

  const size = (t: Trade) =>
    t.status === "pending" ? (
      <span className="text-amber-300">pending</span>
    ) : t.size_unit === "stake" ? (
      money(t.size)
    ) : t.size_unit === "lots" ? (
      `${t.size} lots`
    ) : (
      `${t.size.toFixed(2)} u`
    );
  const botLabel = (t: Trade) =>
    (t.bot_id && bots.get(t.bot_id)?.name) || (t.external ? `Other EA / manual${t.magic ? ` #${t.magic}` : ""}` : "—");
  const account = (t: Trade) => (t.broker_account_id && brokers.get(t.broker_account_id)?.label) || "—";
  const currency = (t: Trade) => (t.broker_account_id && brokers.get(t.broker_account_id)?.currency) || "USD";

  return (
    <>
      {/* Phones: one card per position */}
      <ul className="space-y-2 md:hidden">
        {trades.map((t) => (
          <li key={t.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{t.symbol}</span>
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                      t.side === "buy" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss",
                    )}
                  >
                    {t.side.toUpperCase()}
                  </span>
                  {showBook && <TradeKindBadge trade={t} />}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {botLabel(t)} · {account(t)}
                </div>
              </div>
              <div className={cn("text-right font-mono text-base font-semibold tabular-nums", pnlClass(t.pnl))}>
                {money(t.pnl, currency(t), true)}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              <div>
                <div className="font-sans text-[10px] uppercase tracking-wider">Size</div>
                <div className="text-foreground">{size(t)}</div>
              </div>
              <div>
                <div className="font-sans text-[10px] uppercase tracking-wider">Entry</div>
                <div className="text-foreground">{price(t.entry_price)}</div>
              </div>
              <div>
                <div className="font-sans text-[10px] uppercase tracking-wider">SL / TP</div>
                <div>
                  {price(t.sl)} / {price(t.tp)}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={() => close(t)}
              disabled={closing === t.id || Boolean(t.close_reason)}
            >
              {t.close_reason ? "Closing…" : "Close position"}
            </Button>
          </li>
        ))}
      </ul>

      {/* Tablets and up: table */}
      <div className="scrollbar-thin -mx-1 hidden overflow-x-auto md:block">
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
                <td className={cn("px-2 py-2.5 font-medium", t.side === "buy" ? "text-profit" : "text-loss")}>
                  {t.side.toUpperCase()}
                </td>
                <td className="px-2 py-2.5 font-mono tabular-nums">{size(t)}</td>
                <td className="px-2 py-2.5 font-mono">{price(t.entry_price)}</td>
                <td className="px-2 py-2.5 font-mono text-muted-foreground">
                  {price(t.sl)} / {price(t.tp)}
                </td>
                <td className="px-2 py-2.5">{bot?.name ?? (t.external ? <span className="text-muted-foreground">Other EA / manual{t.magic ? ` #${t.magic}` : ""}</span> : "—")}</td>
                <td className="px-2 py-2.5 text-muted-foreground">
                  {broker?.label ?? "—"}
                  {showBook && <TradeKindBadge trade={t} className="ml-2" />}
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
    </>
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
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-base text-foreground sm:text-sm focus:border-profit/50 focus:outline-none [&>option]:bg-ink [&>optgroup]:bg-ink";

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
