import "server-only";

import { derivCandles, derivClose, derivOpen, derivSnapshot, type Candle } from "@/lib/brokers/deriv";
import { decryptSecret } from "@/lib/secrets";
import { atrSeries, getStrategy } from "@/lib/strategies";
import { advanceBookState, checkRisk, derivStake } from "@/lib/trading/risk";
import { dayKey, getSettings, getStore, log, newId, nowIso, updateSettings } from "@/lib/trading/store";
import type { Book, Bot, BrokerAccount, Side, Signal, SignalAction, Trade } from "@/lib/trading/types";

/** External calls, swappable in tests. */
export const deps = {
  candles: derivCandles,
  derivOpen,
  derivClose,
  derivSnapshot,
};

const ACTIVE: Trade["status"][] = ["pending", "open"];

// ---------------------------------------------------------------------------
// Prices

const priceCache = new Map<string, { price: number; at: number }>();

export async function latestPrice(dataSymbol: string): Promise<number | null> {
  const cached = priceCache.get(dataSymbol);
  if (cached && Date.now() - cached.at < 5000) return cached.price;
  try {
    const candles = await deps.candles(dataSymbol, 60, 1);
    const price = candles.at(-1)?.close ?? null;
    if (price !== null) priceCache.set(dataSymbol, { price, at: Date.now() });
    return price;
  } catch {
    return cached?.price ?? null;
  }
}

function unrealised(trade: Trade, price: number): number {
  if (trade.entry_price === null) return 0;
  return (price - trade.entry_price) * (trade.side === "buy" ? 1 : -1) * trade.size;
}

// ---------------------------------------------------------------------------
// Equity and book state

export async function activeTrades(filter: Partial<Trade> = {}): Promise<Trade[]> {
  return getStore().trades.all({ eq: filter, in: { field: "status", values: ACTIVE } });
}

export async function bookEquity(book: Book): Promise<number> {
  const store = getStore();
  if (book === "live") {
    // Last known equity of every account, connected or not: a terminal going
    // offline must not look like a 100% drawdown and fire the kill switch.
    const brokers = await store.brokers.all();
    return brokers.reduce((sum, b) => sum + b.equity, 0);
  }
  const settings = await getSettings();
  const closed = await store.trades.all({ eq: { book: "paper", status: "closed" } });
  const open = await activeTrades({ book: "paper" });
  return (
    settings.paper_starting_balance +
    closed.reduce((s, t) => s + t.pnl, 0) +
    open.reduce((s, t) => s + t.pnl, 0)
  );
}

/**
 * Shift the live book's day-start and peak when an account joins or leaves,
 * so adding a broker isn't counted as profit and removing one as a loss.
 */
export async function adjustLiveBaseline(delta: number): Promise<void> {
  if (!delta) return;
  const settings = await getSettings();
  const live = settings.books.live;
  await updateSettings({
    books: {
      ...settings.books,
      live: {
        ...live,
        peak_equity: Math.max(0, live.peak_equity + delta),
        day_start_equity: Math.max(0, live.day_start_equity + delta),
      },
    },
  });
}

async function refreshBook(book: Book) {
  const settings = await getSettings();
  const equity = await bookEquity(book);
  const state = advanceBookState(settings.books[book], equity, dayKey());
  if (JSON.stringify(state) !== JSON.stringify(settings.books[book])) {
    await updateSettings({ books: { ...settings.books, [book]: state } });
  }
  return { equity, state };
}

// ---------------------------------------------------------------------------
// Opening trades

interface OpenRequest {
  side: Side;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  /** Used when the signal has no explicit SL price (built-in strategies: ATR × multiple). */
  stopDistance?: number | null;
  /** Reward:risk used with stopDistance when no explicit TP is given. */
  rr?: number | null;
}

async function brokerFor(bot: Bot): Promise<BrokerAccount | null> {
  return bot.broker_account_id ? getStore().brokers.get(bot.broker_account_id) : null;
}

export async function openTrade(
  bot: Bot,
  req: OpenRequest,
): Promise<{ ok: true; trade: Trade } | { ok: false; reason: string }> {
  const store = getStore();
  const settings = await getSettings();
  const { equity, state } = await refreshBook(bot.book);
  const decision = checkRisk({
    settings,
    book: bot.book,
    bot,
    equity,
    bookState: state,
    openTradesInBook: (await activeTrades({ book: bot.book })).length,
    openTradesForBot: (await activeTrades({ bot_id: bot.id })).length,
  });

  if (!decision.ok) {
    if (decision.breach) await handleBreach(bot.book, decision.breach, decision.reason);
    return { ok: false, reason: decision.reason };
  }

  const dir = req.side === "buy" ? 1 : -1;
  const price = req.price ?? (await latestPrice(bot.data_symbol));
  let sl = req.sl ?? null;
  let tp = req.tp ?? null;
  if (price && sl === null && req.stopDistance) sl = price - dir * req.stopDistance;
  if (price && tp === null && req.stopDistance && req.rr) tp = price + dir * req.rr * req.stopDistance;
  const stopDistance = price && sl !== null ? Math.abs(price - sl) : null;

  const base: Trade = {
    id: newId(),
    bot_id: bot.id,
    broker_account_id: bot.book === "live" ? bot.broker_account_id : null,
    book: bot.book,
    symbol: bot.symbol,
    data_symbol: bot.data_symbol,
    side: req.side,
    size: 0,
    size_unit: "units",
    entry_price: price ?? null,
    current_price: price ?? null,
    sl,
    tp,
    risk_amount: decision.riskAmount,
    pnl: 0,
    status: "pending",
    broker_ref: null,
    magic: bot.magic,
    external: false,
    close_reason: null,
    exit_price: null,
    opened_at: nowIso(),
    closed_at: null,
  };

  if (bot.book === "paper") {
    if (!price) return { ok: false, reason: `No price available for ${bot.data_symbol}` };
    // Without a stop, size as if the stop were 1% away.
    const dist = stopDistance || price * 0.01;
    const trade = { ...base, status: "open" as const, size: decision.riskAmount / dist };
    await store.trades.insert(trade);
    await log("trade", `PAPER ${req.side.toUpperCase()} ${bot.symbol} @ ${price}`, { bot_id: bot.id });
    return { ok: true, trade };
  }

  const broker = await brokerFor(bot);
  if (!broker) return { ok: false, reason: "Bot has no broker account connected" };
  if (broker.status !== "connected") return { ok: false, reason: `${broker.label} is not connected` };

  if (broker.kind === "deriv") {
    const { stake, stopLossAmount } = derivStake({
      riskAmount: decision.riskAmount,
      entry: price ?? 0,
      stopDistance,
      multiplier: bot.deriv_multiplier,
      equity,
    });
    const takeProfitAmount =
      price && tp !== null ? (stake * bot.deriv_multiplier * Math.abs(tp - price)) / price : undefined;
    try {
      const res = await deps.derivOpen(decryptSecret(broker.encrypted_token!), {
        symbol: bot.symbol,
        side: req.side,
        stake,
        multiplier: bot.deriv_multiplier,
        currency: broker.currency,
        stopLossAmount,
        takeProfitAmount,
      });
      const trade: Trade = {
        ...base,
        status: "open",
        size: res.buy_price,
        size_unit: "stake",
        broker_ref: res.contract_id,
        entry_price: res.entry_spot ?? price ?? null,
      };
      await store.trades.insert(trade);
      await log("trade", `DERIV ${req.side.toUpperCase()} ${bot.symbol} stake ${res.buy_price} ×${bot.deriv_multiplier}`, {
        bot_id: bot.id,
        context: { contract_id: res.contract_id },
      });
      return { ok: true, trade };
    } catch (error) {
      const reason = `Deriv rejected the order: ${(error as Error).message}`;
      await store.trades.insert({ ...base, status: "rejected", close_reason: reason, closed_at: nowIso() });
      await log("error", reason, { bot_id: bot.id });
      return { ok: false, reason };
    }
  }

  // MT5: queue for the bridge EA, which sizes the lot from risk_money and the stop.
  const trade: Trade = { ...base, size_unit: "lots" };
  await store.trades.insert(trade);
  await store.commands.insert({
    id: newId(),
    account_id: broker.id,
    trade_id: trade.id,
    type: "open",
    payload: {
      symbol: bot.symbol,
      side: req.side,
      risk_money: Number(decision.riskAmount.toFixed(2)),
      sl: sl ?? 0,
      tp: tp ?? 0,
      magic: bot.magic,
      comment: `amg:${trade.id.slice(0, 8)}`,
    },
    status: "queued",
    result: null,
    created_at: nowIso(),
    sent_at: null,
  });
  await log("trade", `MT5 ${req.side.toUpperCase()} ${bot.symbol} queued for ${broker.label}`, { bot_id: bot.id });
  return { ok: true, trade };
}

// ---------------------------------------------------------------------------
// Closing trades

export async function closeTrade(trade: Trade, reason: string): Promise<Trade> {
  const store = getStore();
  if (!ACTIVE.includes(trade.status)) return trade;

  if (trade.book === "paper" || !trade.broker_account_id) {
    const price = (trade.data_symbol && (await latestPrice(trade.data_symbol))) || trade.current_price || trade.entry_price;
    const pnl = price ? unrealised(trade, price) : trade.pnl;
    const closed = await store.trades.update(trade.id, {
      status: "closed",
      exit_price: price,
      current_price: price,
      pnl,
      close_reason: reason,
      closed_at: nowIso(),
    });
    await log("trade", `PAPER close ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${reason})`, {
      bot_id: trade.bot_id,
    });
    return closed!;
  }

  const broker = await store.brokers.get(trade.broker_account_id);
  if (!broker) throw new Error("Broker account no longer exists");

  if (broker.kind === "deriv") {
    const res = await deps.derivClose(decryptSecret(broker.encrypted_token!), trade.broker_ref!);
    const pnl = res.sold_for - trade.size;
    const closed = await store.trades.update(trade.id, {
      status: "closed",
      pnl,
      close_reason: reason,
      closed_at: nowIso(),
    });
    await log("trade", `DERIV close ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${reason})`, {
      bot_id: trade.bot_id,
    });
    return closed!;
  }

  // MT5
  if (trade.status === "pending") {
    const queued = await store.commands.all({ eq: { trade_id: trade.id, status: "queued" } });
    if (queued.length) {
      for (const c of queued) await store.commands.update(c.id, { status: "failed", result: { error: "cancelled" } });
      return (await store.trades.update(trade.id, { status: "rejected", close_reason: `Cancelled: ${reason}`, closed_at: nowIso() }))!;
    }
  }
  await store.commands.insert({
    id: newId(),
    account_id: broker.id,
    trade_id: trade.id,
    type: "close",
    payload: { ticket: trade.broker_ref ?? "", comment: `amg:${trade.id.slice(0, 8)}` },
    status: "queued",
    result: null,
    created_at: nowIso(),
    sent_at: null,
  });
  await log("trade", `MT5 close ${trade.symbol} queued (${reason})`, { bot_id: trade.bot_id });
  return (await store.trades.update(trade.id, { close_reason: reason }))!;
}

export async function setKillSwitch(on: boolean, reason = "Kill switch pressed"): Promise<void> {
  const store = getStore();
  await updateSettings({ kill_switch: on });
  if (!on) {
    await log("warn", "Kill switch released — bots stay paused until you start them");
    return;
  }
  for (const bot of await store.bots.all({ eq: { status: "running" } })) {
    await store.bots.update(bot.id, { status: "paused", paused_reason: reason });
  }
  for (const trade of await activeTrades()) {
    try {
      await closeTrade(trade, reason);
    } catch (error) {
      await log("error", `Could not close ${trade.symbol}: ${(error as Error).message}`, { bot_id: trade.bot_id });
    }
  }
  // Also flatten positions Amogana does not track (e.g. your own EAs).
  for (const broker of await store.brokers.all({ eq: { kind: "mt5" } })) {
    await store.commands.insert({
      id: newId(),
      account_id: broker.id,
      trade_id: null,
      type: "close_all",
      payload: {},
      status: "queued",
      result: null,
      created_at: nowIso(),
      sent_at: null,
    });
  }
  await log("error", `KILL SWITCH: ${reason}. All bots paused, all positions closing.`);
}

async function handleBreach(book: Book, breach: "daily_loss" | "drawdown", reason: string) {
  const store = getStore();
  if (breach === "drawdown") {
    await setKillSwitch(true, reason);
    return;
  }
  const running = await store.bots.all({ eq: { status: "running", book } });
  if (!running.length) return;
  for (const bot of running) await store.bots.update(bot.id, { status: "paused", paused_reason: reason });
  await log("warn", `${reason} — paused ${running.length} ${book} bot(s) until you restart them`);
}

// ---------------------------------------------------------------------------
// Signals (TradingView, manual, built-in strategies)

export interface SignalInput {
  bot: Bot;
  source: Signal["source"];
  action: SignalAction;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  external_id?: string | null;
  stopDistance?: number | null;
  rr?: number | null;
}

export async function processSignal(input: SignalInput): Promise<Signal> {
  const store = getStore();
  const { bot } = input;

  const record = async (status: Signal["status"], reason: string | null): Promise<Signal> => {
    const signal: Signal = {
      id: newId(),
      bot_id: bot.id,
      source: input.source,
      action: input.action,
      symbol: bot.symbol,
      price: input.price ?? null,
      sl: input.sl ?? null,
      tp: input.tp ?? null,
      external_id: input.external_id ?? null,
      status,
      reason,
      received_at: nowIso(),
    };
    await store.signals.insert(signal);
    if (status === "rejected") await log("warn", `${bot.name}: ${input.action} signal rejected — ${reason}`, { bot_id: bot.id });
    return signal;
  };

  if (input.external_id) {
    const dup = await store.signals.all({ eq: { bot_id: bot.id, external_id: input.external_id }, limit: 1 });
    if (dup.length) return record("duplicate", "Already processed");
  }
  await store.bots.update(bot.id, { last_signal_at: nowIso() });

  const settings = await getSettings();
  if (settings.kill_switch) return record("rejected", "Kill switch is on");
  if (bot.status !== "running") return record("rejected", "Bot is paused");

  const open = await activeTrades({ bot_id: bot.id });

  if (input.action === "close") {
    for (const t of open) await closeTrade(t, "Close signal");
    return record("accepted", open.length ? null : "Nothing to close");
  }

  for (const t of open.filter((t) => t.side !== input.action)) await closeTrade(t, "Reversed by opposite signal");
  if (open.some((t) => t.side === input.action)) return record("rejected", `Already ${input.action === "buy" ? "long" : "short"}`);

  const result = await openTrade(bot, {
    side: input.action,
    price: input.price,
    sl: input.sl,
    tp: input.tp,
    stopDistance: input.stopDistance,
    rr: input.rr,
  });
  return result.ok ? record("accepted", null) : record("rejected", result.reason);
}

// ---------------------------------------------------------------------------
// Periodic engine tick: sync brokers, mark paper trades, run built-in bots

function closedCandles(candles: Candle[], timeframe: number): Candle[] {
  const now = Date.now() / 1000;
  return candles.filter((c) => c.epoch + timeframe <= now);
}

export async function syncDerivAccount(broker: BrokerAccount): Promise<void> {
  const store = getStore();
  try {
    const tracked = await activeTrades({ broker_account_id: broker.id });
    const snap = await deps.derivSnapshot(
      decryptSecret(broker.encrypted_token!),
      tracked.map((t) => t.broker_ref!).filter(Boolean),
    );
    await store.brokers.update(broker.id, {
      balance: snap.balance,
      equity: snap.equity,
      currency: snap.currency,
      status: "connected",
      error: null,
      last_sync_at: nowIso(),
    });
    for (const c of snap.contracts) {
      const trade = tracked.find((t) => t.broker_ref === c.contract_id);
      if (trade) {
        await store.trades.update(trade.id, {
          pnl: c.profit,
          current_price: c.current_spot,
          entry_price: trade.entry_price ?? c.entry_spot,
          ...(c.is_sold
            ? { status: "closed" as const, exit_price: c.exit_spot, closed_at: nowIso(), close_reason: trade.close_reason ?? "Closed on Deriv (stop/target)" }
            : {}),
        });
      } else if (!c.is_sold) {
        await store.trades.insert({
          id: newId(),
          bot_id: null,
          broker_account_id: broker.id,
          book: "live",
          symbol: c.symbol,
          data_symbol: c.symbol,
          side: c.side,
          size: c.stake,
          size_unit: "stake",
          entry_price: c.entry_spot,
          current_price: c.current_spot,
          sl: null,
          tp: null,
          risk_amount: 0,
          pnl: c.profit,
          status: "open",
          broker_ref: c.contract_id,
          magic: null,
          external: true,
          close_reason: null,
          exit_price: null,
          opened_at: nowIso(),
          closed_at: null,
        });
      }
    }
  } catch (error) {
    await store.brokers.update(broker.id, { status: "error", error: (error as Error).message, last_sync_at: nowIso() });
  }
}

async function markPaperTrades() {
  const store = getStore();
  for (const trade of await activeTrades({ book: "paper" })) {
    if (!trade.data_symbol) continue;
    let candles: Candle[];
    try {
      candles = await deps.candles(trade.data_symbol, 60, 2);
    } catch {
      continue;
    }
    const bar = candles.at(-1);
    if (!bar) continue;
    const long = trade.side === "buy";
    const stopHit = trade.sl !== null && (long ? bar.low <= trade.sl : bar.high >= trade.sl);
    const targetHit = trade.tp !== null && (long ? bar.high >= trade.tp : bar.low <= trade.tp);
    if (stopHit || targetHit) {
      const exit = stopHit ? trade.sl! : trade.tp!;
      const pnl = unrealised(trade, exit);
      await store.trades.update(trade.id, {
        status: "closed",
        exit_price: exit,
        current_price: exit,
        pnl,
        close_reason: stopHit ? "Stop loss" : "Take profit",
        closed_at: nowIso(),
      });
      await log("trade", `PAPER ${stopHit ? "stop" : "target"} ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, {
        bot_id: trade.bot_id,
      });
    } else {
      await store.trades.update(trade.id, { current_price: bar.close, pnl: unrealised(trade, bar.close) });
    }
  }
}

export async function runBuiltinBot(bot: Bot): Promise<string> {
  const store = getStore();
  const def = bot.strategy ? getStrategy(bot.strategy.id) : undefined;
  if (!def || !bot.strategy) return "no strategy";

  const candles = closedCandles(await deps.candles(bot.data_symbol, bot.timeframe, 400), bot.timeframe);
  const last = candles.at(-1);
  if (!last || candles.length < 210) return "not enough data";
  if (bot.last_bar_epoch === last.epoch) return "waiting for next bar";
  await store.bots.update(bot.id, { last_bar_epoch: last.epoch });

  const params = bot.strategy.params;
  const positions = def.positions(candles, params);
  const want = positions[positions.length - 1];
  const prev = positions[positions.length - 2];
  const open = await activeTrades({ bot_id: bot.id });
  const current = open[0];
  const currentDir = current ? (current.side === "buy" ? 1 : -1) : 0;

  if (current && want !== currentDir) {
    await processSignal({ bot, source: "builtin", action: "close" });
    if (want === 0) return "closed";
  }
  if (want !== 0 && want !== prev && want !== currentDir) {
    const atr = atrSeries(candles).at(-1)!;
    await processSignal({
      bot,
      source: "builtin",
      action: want === 1 ? "buy" : "sell",
      price: bot.book === "paper" ? last.close : null,
      stopDistance: atr * (params.atr_mult ?? 2),
      rr: params.rr ?? 0,
    });
    return want === 1 ? "buy" : "sell";
  }
  return "hold";
}

let tickInFlight: Promise<TickReport> | null = null;

export interface TickReport {
  at: string;
  bots: Record<string, string>;
}

/** Called every minute by the dashboard (while open) and/or an external cron. */
export function runEngineTick(): Promise<TickReport> {
  if (!tickInFlight) tickInFlight = doTick().finally(() => (tickInFlight = null));
  return tickInFlight;
}

let lastEquityPoint: Record<Book, number> = { paper: 0, live: 0 };

async function doTick(): Promise<TickReport> {
  const store = getStore();
  const report: TickReport = { at: nowIso(), bots: {} };

  for (const broker of await store.brokers.all()) {
    if (broker.kind === "deriv") await syncDerivAccount(broker);
    else if (broker.status === "connected" && broker.last_sync_at && Date.now() - Date.parse(broker.last_sync_at) > 120_000) {
      await store.brokers.update(broker.id, { status: "waiting", error: "MT5 bridge has not checked in for 2 minutes" });
    }
  }

  await markPaperTrades();

  const settings = await getSettings();
  if (!settings.kill_switch) {
    for (const bot of await store.bots.all({ eq: { status: "running", source: "builtin" } })) {
      try {
        report.bots[bot.name] = await runBuiltinBot(bot);
      } catch (error) {
        report.bots[bot.name] = `error: ${(error as Error).message}`;
        await log("error", `${bot.name}: ${(error as Error).message}`, { bot_id: bot.id });
      }
    }
  }

  for (const book of ["paper", "live"] as const) {
    const { equity, state } = await refreshBook(book);
    if (equity <= 0) continue;
    const s = await getSettings();
    if (s.max_drawdown_percent > 0 && state.peak_equity > 0 && !s.kill_switch) {
      const dd = ((state.peak_equity - equity) / state.peak_equity) * 100;
      if (dd >= s.max_drawdown_percent) await handleBreach(book, "drawdown", `${book} drawdown ${dd.toFixed(1)}% hit the ${s.max_drawdown_percent}% limit`);
    }
    if (s.daily_loss_limit > 0 && state.day_start_equity - equity >= s.daily_loss_limit) {
      await handleBreach(book, "daily_loss", `${book} daily loss limit of ${s.daily_loss_limit} reached`);
    }
    if (Date.now() - lastEquityPoint[book] > 5 * 60_000) {
      lastEquityPoint = { ...lastEquityPoint, [book]: Date.now() };
      await store.equity.insert({ id: newId(), book, equity, created_at: nowIso() });
    }
  }

  return report;
}
