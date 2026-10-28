"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CandlestickChart,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Octagon,
  PlugZap,
  Plus,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import { BrandMark, Wordmark } from "@/components/app/brand";
import { DashboardProvider, useDashboard } from "@/components/app/dashboard-context";
import { FeedbackProvider, useFeedback } from "@/components/app/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", short: "Home", icon: LayoutDashboard },
  { href: "/dashboard/bots", label: "Bots", short: "Bots", icon: Bot },
  { href: "/dashboard/trades", label: "Trades", short: "Trades", icon: CandlestickChart },
  { href: "/dashboard/strategy-lab", label: "Strategy Lab", short: "Lab", icon: FlaskConical },
  { href: "/dashboard/brokers", label: "Brokers", short: "Brokers", icon: PlugZap },
  { href: "/dashboard/risk", label: "Risk Guard", short: "Risk", icon: ShieldCheck },
  { href: "/dashboard/logs", label: "Alerts & Logs", short: "Logs", icon: ScrollText },
];

// Phones show the first four in the tab bar; the rest live under "More".
const TAB_COUNT = 4;

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <FeedbackProvider>
      <DashboardProvider>
        <div className="flex min-h-[100dvh] flex-col lg:flex-row">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-6">
              {children}
            </main>
          </div>
          <TabBar />
        </div>
      </DashboardProvider>
    </FeedbackProvider>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <Link href="/dashboard" className={cn("flex items-center gap-2", className)}>
      <BrandMark />
      <Wordmark />
    </Link>
  );
}

function EngineStatus({ compact = false }: { compact?: boolean }) {
  const { state, lastTick, error } = useDashboard();
  const ok = !error && Boolean(lastTick);
  if (compact) {
    return (
      <span className={cn("flex items-center gap-1.5 text-xs", ok ? "text-profit" : "text-amber-300")}>
        <span className={cn("h-2 w-2 rounded-full", ok ? "animate-pulse bg-profit" : "bg-amber-300")} />
        {ok ? "Engine on" : "Connecting"}
      </span>
    );
  }
  const brokersUp = state?.brokers.filter((b) => b.status === "connected").length ?? 0;
  return (
    <div className="glass rounded-xl p-3 text-xs">
      <div className="uppercase tracking-widest text-muted-foreground">Engine</div>
      <div className={cn("mt-2 flex items-center gap-2", ok ? "text-profit" : "text-amber-300")}>
        <Activity className="h-3.5 w-3.5" />
        {lastTick ? `Ran ${timeAgo(lastTick)}` : "Starting…"}
      </div>
      <div className="mt-1 text-muted-foreground">
        {brokersUp} broker{brokersUp === 1 ? "" : "s"} connected
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden border-r border-white/5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col">
      <div className="px-5 py-6">
        <Logo className="text-lg" />
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              isActive(pathname, href)
                ? "bg-profit/10 font-medium text-profit"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto p-3">
        <EngineStatus />
      </div>
    </aside>
  );
}

function useKillSwitch() {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const on = state?.settings.kill_switch ?? false;

  const toggle = async () => {
    const ok = await confirm(
      on
        ? {
            title: "Release the kill switch?",
            description: "Bots stay paused until you start each one again.",
            confirmLabel: "Release",
          }
        : {
            title: "Activate kill switch?",
            description:
              "Every bot pauses and every open position closes — including positions from other EAs on your MT5 accounts.",
            confirmLabel: "Stop everything",
            danger: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/kill-switch", "POST", { on: !on });
      await refresh();
      toast(on ? "Kill switch released" : "Kill switch active — all bots paused", on ? "success" : "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return { on, busy, toggle, ready: Boolean(state) };
}

async function logout() {
  await api("/api/auth/logout", "POST").catch(() => undefined);
  window.location.href = "/login";
}

function TopBar() {
  const { state } = useDashboard();
  const kill = useKillSwitch();
  const running = state?.bots.filter((b) => b.status === "running").length ?? 0;

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
        {/* Phones */}
        <div className="flex items-center gap-3 lg:hidden">
          <Logo className="text-base" />
          <EngineStatus compact />
        </div>
        {/* Desktop */}
        <div className="hidden items-center gap-4 text-sm text-muted-foreground lg:flex">
          <EngineStatus compact />
          {state ? (
            <span>
              <span className="text-foreground">{running}</span> bots running ·{" "}
              <span className="text-foreground">{state.open_trades.length}</span> open positions
            </span>
          ) : (
            <span className="h-4 w-48 animate-pulse rounded bg-white/5" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="hidden lg:inline-flex">
            <Link href="/dashboard/brokers">
              <PlugZap /> Connect broker
            </Link>
          </Button>
          <Button size="sm" asChild className="hidden lg:inline-flex">
            <Link href="/dashboard/bots?new=1">
              <Plus /> New bot
            </Link>
          </Button>
          <Button
            variant={kill.on ? "outline" : "destructive"}
            size="sm"
            onClick={kill.toggle}
            disabled={kill.busy || !kill.ready}
            aria-label={kill.on ? "Release kill switch" : "Kill switch"}
            className="px-3"
          >
            <Octagon />
            <span className="sm:hidden">{kill.on ? "Release" : "Stop all"}</span>
            <span className="hidden sm:inline">{kill.on ? "Release kill switch" : "Kill switch"}</span>
          </Button>
          {state?.meta.auth && (
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Log out" className="hidden lg:inline-flex">
              <LogOut />
            </Button>
          )}
        </div>
      </div>
      {kill.on && (
        <div className="border-t border-loss/30 bg-loss/10 px-4 py-2 text-center text-xs font-medium text-loss sm:text-sm">
          Kill switch is ON — no new trades will be placed.
        </div>
      )}
    </header>
  );
}

function TabBar() {
  const pathname = usePathname();
  const { state } = useDashboard();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = NAV.slice(0, TAB_COUNT);
  const more = NAV.slice(TAB_COUNT);
  const moreActive = more.some((n) => isActive(pathname, n.href));

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="grid grid-cols-5">
          {tabs.map(({ href, short, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-profit" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {short}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
              moreActive ? "text-profit" : "text-muted-foreground",
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="lg:hidden">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/dashboard/bots?new=1" className="flex items-center gap-2 rounded-xl bg-profit px-3 py-3 text-sm font-semibold text-ink">
              <Plus className="h-4 w-4" /> New bot
            </Link>
            <Link href="/dashboard/brokers" className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-3 text-sm">
              <PlugZap className="h-4 w-4" /> Connect broker
            </Link>
          </div>
          <div className="divide-y divide-white/5 rounded-xl border border-white/10">
            {more.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn("flex items-center gap-3 px-4 py-3.5 text-sm", isActive(pathname, href) ? "text-profit" : "text-foreground")}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                {label}
              </Link>
            ))}
            {state?.meta.auth && (
              <button onClick={logout} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm text-loss">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            )}
          </div>
          <EngineStatus />
        </DialogContent>
      </Dialog>
    </>
  );
}
