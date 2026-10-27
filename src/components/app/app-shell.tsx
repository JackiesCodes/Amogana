"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  Bot,
  CandlestickChart,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Octagon,
  PlugZap,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import { DashboardProvider, useDashboard } from "@/components/app/dashboard-context";
import { Button } from "@/components/ui/button";
import { api, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/bots", label: "Bots", icon: Bot },
  { href: "/dashboard/brokers", label: "Brokers", icon: PlugZap },
  { href: "/dashboard/trades", label: "Trades", icon: CandlestickChart },
  { href: "/dashboard/strategy-lab", label: "Strategy Lab", icon: FlaskConical },
  { href: "/dashboard/risk", label: "Risk Guard", icon: ShieldCheck },
  { href: "/dashboard/logs", label: "Alerts & Logs", icon: ScrollText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 px-4 pb-10 pt-4 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </DashboardProvider>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { state, lastTick } = useDashboard();
  const brokersUp = state?.brokers.filter((b) => b.status === "connected").length ?? 0;

  return (
    <aside className="border-b border-white/5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:flex-col lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-5 py-4 lg:py-6">
        <Link href="/dashboard" className="text-lg font-extrabold tracking-[0.08em] text-liquid-platinum">
          AMOGANA<span className="text-cyber-mint">.</span>
        </Link>
      </div>
      <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active ? "bg-cyber-mint/10 text-cyber-mint" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden p-3 lg:block">
        <div className="glass rounded-xl p-3 text-xs">
          <div className="uppercase tracking-widest text-muted-foreground">Engine</div>
          <div className="mt-2 flex items-center gap-2 text-cyber-mint">
            <Activity className="h-3.5 w-3.5" />
            {lastTick ? `Ran ${timeAgo(lastTick)}` : "Starting…"}
          </div>
          <div className="mt-1 text-muted-foreground">
            {brokersUp} broker{brokersUp === 1 ? "" : "s"} connected · {state?.meta.backend === "supabase" ? "Supabase" : "Local file"} storage
          </div>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  const { state, refresh } = useDashboard();
  const [busy, setBusy] = useState(false);
  const killOn = state?.settings.kill_switch ?? false;

  const toggleKill = async () => {
    const msg = killOn
      ? "Release the kill switch? Bots stay paused until you start them again."
      : "KILL SWITCH: pause every bot and close every open position (including other EAs on your MT5 accounts)?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api("/api/kill-switch", "POST", { on: !killOn });
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", "POST").catch(() => undefined);
    window.location.href = "/login";
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-obsidian/80 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {state ? (
            <>
              <span className="text-foreground">{state.bots.filter((b) => b.status === "running").length}</span> bots running ·{" "}
              <span className="text-foreground">{state.open_trades.length}</span> open positions
            </>
          ) : (
            "Loading…"
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/brokers">+ Connect broker</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/bots?new=1">+ New bot</Link>
          </Button>
          <Button variant={killOn ? "outline" : "destructive"} size="sm" onClick={toggleKill} disabled={busy || !state}>
            <Octagon />
            {killOn ? "Release kill switch" : "Kill switch"}
          </Button>
          {state?.meta.auth && (
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out">
              <LogOut />
            </Button>
          )}
        </div>
      </div>
      {killOn && (
        <div className="mt-3 rounded-xl border border-neon-crimson/40 bg-neon-crimson/10 px-4 py-2 text-sm text-neon-crimson">
          Kill switch is ON — no new trades will be placed. Release it, then start bots individually.
        </div>
      )}
    </header>
  );
}
