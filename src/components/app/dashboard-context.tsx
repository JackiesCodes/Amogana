"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/client";
import type { DashboardState } from "@/lib/trading/state";
import type { Book } from "@/lib/trading/types";

interface DashboardContextValue {
  state: DashboardState | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Which book the overview shows. */
  view: Book;
  setView: (book: Book) => void;
  lastTick: string | null;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

const STATE_POLL_MS = 5_000;
const TICK_MS = 60_000;

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<Book>("paper");
  const [lastTick, setLastTick] = useState<string | null>(null);
  const viewChosen = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api<DashboardState>("/api/state");
      setState(next);
      setError(null);
      // Default to the live view once anything is trading live.
      if (!viewChosen.current && next.bots.some((b) => b.book === "live")) setViewState("live");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const setView = useCallback((book: Book) => {
    viewChosen.current = true;
    setViewState(book);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(refresh, STATE_POLL_MS);

    // While the dashboard is open it also drives the bot runner. For 24/7
    // operation point a scheduler at /api/cron/tick (see README).
    const tick = async () => {
      try {
        const report = await api<{ at: string }>("/api/engine/tick", "POST");
        setLastTick(report.at);
        void refresh();
      } catch {
        // Surfaced via logs/broker status instead.
      }
    };
    void tick();
    const tickTimer = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(tickTimer);
    };
  }, [refresh]);

  return (
    <DashboardContext.Provider value={{ state, error, refresh, view, setView, lastTick }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}
