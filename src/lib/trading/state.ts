import "server-only";

import { activeTrades, bookEquity } from "@/lib/trading/engine";
import { getSettings, getStore } from "@/lib/trading/store";
import type { Book, Bot, BrokerAccount, EquityPoint, EventLog, Settings, Signal, Trade } from "@/lib/trading/types";

export type PublicBroker = Omit<BrokerAccount, "encrypted_token" | "bridge_key_hash">;

export interface BookKpis {
  equity: number;
  today_pnl: number;
  open_positions: number;
  win_rate_30d: number | null;
  profit_factor_30d: number | null;
  closed_30d: number;
  drawdown_percent: number;
}

export interface DashboardState {
  settings: Settings;
  brokers: PublicBroker[];
  bots: Bot[];
  open_trades: Trade[];
  closed_trades: Trade[];
  signals: Signal[];
  logs: EventLog[];
  equity: Record<Book, EquityPoint[]>;
  kpis: Record<Book, BookKpis>;
  meta: { backend: "supabase" | "file"; auth: boolean; generated_at: string };
}

export function publicBroker(b: BrokerAccount): PublicBroker {
  const rest: Partial<BrokerAccount> = { ...b };
  delete rest.encrypted_token;
  delete rest.bridge_key_hash;
  return rest as PublicBroker;
}

async function kpisFor(book: Book, settings: Settings, closed: Trade[], open: Trade[]): Promise<BookKpis> {
  const equity = await bookEquity(book);
  const since = Date.now() - 30 * 86400_000;
  const recent = closed.filter((t) => t.book === book && t.closed_at && Date.parse(t.closed_at) >= since);
  const wins = recent.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -recent.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  const state = settings.books[book];
  return {
    equity,
    today_pnl: state.day_start_equity ? equity - state.day_start_equity : 0,
    open_positions: open.filter((t) => t.book === book).length,
    win_rate_30d: recent.length ? (wins.length / recent.length) * 100 : null,
    profit_factor_30d: recent.length ? (grossLoss > 0 ? grossWin / grossLoss : null) : null,
    closed_30d: recent.length,
    drawdown_percent: state.peak_equity > 0 ? Math.max(0, ((state.peak_equity - equity) / state.peak_equity) * 100) : 0,
  };
}

export async function getDashboardState(): Promise<DashboardState> {
  const store = getStore();
  const settings = await getSettings();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [brokers, bots, open, closed, signals, logs, equity] = await Promise.all([
    store.brokers.all({ order: { field: "created_at" } }),
    store.bots.all({ order: { field: "created_at" } }),
    activeTrades(),
    store.trades.all({ in: { field: "status", values: ["closed", "rejected"] }, order: { field: "closed_at", ascending: false }, limit: 200 }),
    store.signals.all({ order: { field: "received_at", ascending: false }, limit: 50 }),
    store.logs.all({ order: { field: "created_at", ascending: false }, limit: 150 }),
    store.equity.all({ since: { field: "created_at", value: since }, order: { field: "created_at" } }),
  ]);

  const closedOnly = closed.filter((t) => t.status === "closed");
  const [real, demo] = await Promise.all([
    kpisFor("real", settings, closedOnly, open),
    kpisFor("demo", settings, closedOnly, open),
  ]);

  return {
    settings,
    brokers: brokers.map(publicBroker),
    bots,
    open_trades: open.sort((a, b) => b.opened_at.localeCompare(a.opened_at)),
    closed_trades: closed,
    signals,
    logs,
    equity: {
      real: equity.filter((e) => e.book === "real"),
      demo: equity.filter((e) => e.book === "demo"),
    },
    kpis: { real, demo },
    meta: { backend: store.backend, auth: Boolean(process.env.APP_PASSWORD), generated_at: new Date().toISOString() },
  };
}
