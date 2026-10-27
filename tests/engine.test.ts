import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ingestMt5Report } from "@/lib/brokers/mt5";
import { activeTrades, bookEquity, deps, processSignal, runEngineTick, setKillSwitch } from "@/lib/trading/engine";
import { getSettings, getStore, newId, nowIso, resetStore, updateSettings } from "@/lib/trading/store";
import type { Bot, BrokerAccount } from "@/lib/trading/types";

let price = 1.1;
deps.candles = async (_symbol, granularity, count) =>
  Array.from({ length: count }, (_, i) => ({
    epoch: Math.floor(Date.now() / 1000) - (count - i) * granularity,
    open: price,
    high: price,
    low: price,
    close: price,
  }));

function makeBot(patch: Partial<Bot> = {}): Bot {
  return {
    id: newId(),
    name: "Test bot",
    source: "tradingview",
    broker_account_id: null,
    book: "paper",
    symbol: "EURUSD",
    data_symbol: "frxEURUSD",
    timeframe: 3600,
    strategy: null,
    status: "running",
    paused_reason: null,
    risk_percent: 1,
    deriv_multiplier: 100,
    magic: 770001,
    webhook_passphrase: "secret",
    last_bar_epoch: null,
    last_signal_at: null,
    created_at: nowIso(),
    ...patch,
  };
}

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "amogana-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  resetStore();
  price = 1.1;
});

describe("paper trading engine", () => {
  it("opens, reverses and books profit", async () => {
    const bot = makeBot();
    await getStore().bots.insert(bot);

    const s1 = await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.09 });
    expect(s1.status).toBe("accepted");
    const [long] = await activeTrades({ bot_id: bot.id });
    expect(long!.size).toBeCloseTo(100 / 0.01); // $100 risk over a 0.01 stop

    price = 1.105;
    const s2 = await processSignal({ bot, source: "tradingview", action: "sell", price: 1.105, sl: 1.115 });
    expect(s2.status).toBe("accepted");
    const closed = await getStore().trades.all({ eq: { status: "closed" } });
    expect(closed[0]!.pnl).toBeCloseTo(50);
    expect((await activeTrades({ bot_id: bot.id }))[0]!.side).toBe("sell");
    expect(await bookEquity("paper")).toBeCloseTo(10_050);
  });

  it("ignores duplicate alerts and paused bots", async () => {
    const bot = makeBot();
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, external_id: "a" });
    expect((await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, external_id: "a" })).status).toBe("duplicate");

    const paused = makeBot({ status: "paused" });
    await getStore().bots.insert(paused);
    expect((await processSignal({ bot: paused, source: "tradingview", action: "buy", price: 1.1 })).status).toBe("rejected");
  });

  it("closes paper trades at their stop during a tick", async () => {
    const bot = makeBot();
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.09 });
    price = 1.08;
    await runEngineTick();
    const [trade] = await getStore().trades.all();
    expect(trade!.status).toBe("closed");
    expect(trade!.close_reason).toBe("Stop loss");
    expect(trade!.pnl).toBeCloseTo(-100);
  });

  it("pauses bots once the daily loss limit is hit", async () => {
    await updateSettings({ daily_loss_limit: 50 });
    const bot = makeBot();
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.09 });
    price = 1.09;
    await runEngineTick();
    expect((await getStore().bots.get(bot.id))!.status).toBe("paused");
    const again = await processSignal({ bot: (await getStore().bots.get(bot.id))!, source: "tradingview", action: "buy", price: 1.09 });
    expect(again.status).toBe("rejected");
  });

  it("kill switch pauses everything and closes positions", async () => {
    const bot = makeBot();
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1 });
    await setKillSwitch(true);
    expect(await activeTrades()).toHaveLength(0);
    expect((await getStore().bots.get(bot.id))!.status).toBe("paused");
  });
});

describe("MT5 bridge", () => {
  async function mt5Account(): Promise<BrokerAccount> {
    const account: BrokerAccount = {
      id: newId(), kind: "mt5", label: "Exness MT5", status: "connected", login: null, server: null,
      currency: "USD", balance: 1000, equity: 1000, is_demo: true, encrypted_token: null,
      bridge_key_hash: "x", last_sync_at: nowIso(), error: null, created_at: nowIso(),
    };
    await getStore().brokers.insert(account);
    return account;
  }

  it("queues an order, links the fill and books the close", async () => {
    const account = await mt5Account();
    const bot = makeBot({ book: "live", broker_account_id: account.id, symbol: "EURUSDm" });
    await getStore().bots.insert(bot);

    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.09 });
    const report = { login: "123", server: "Exness-MT5Trial", company: "Exness", currency: "USD", balance: 1000, equity: 1000, is_demo: true, positions: [], deals: [], results: [] };
    const lines = (await ingestMt5Report(account, report)).split("\n");
    expect(lines).toHaveLength(1);
    const [commandId, type, symbol, side, riskMoney] = lines[0]!.split("|");
    expect([type, symbol, side, riskMoney]).toEqual(["open", "EURUSDm", "buy", "10"]);

    await ingestMt5Report(account, {
      ...report,
      results: [{ command_id: commandId!, ok: true, ticket: "555", price: 1.1001, volume: 0.1 }],
      positions: [{ ticket: "555", symbol: "EURUSDm", type: "buy", volume: 0.1, price_open: 1.1001, price_current: 1.1011, sl: 1.09, tp: 0, profit: 10, magic: 770001, comment: "" }],
    });
    let [trade] = await activeTrades({ bot_id: bot.id });
    expect(trade).toMatchObject({ status: "open", broker_ref: "555", pnl: 10 });

    await ingestMt5Report(account, { ...report, deals: [{ position_id: "555", profit: 25, price: 1.1026 }] });
    [trade] = await getStore().trades.all({ eq: { bot_id: bot.id } });
    expect(trade).toMatchObject({ status: "closed", pnl: 25 });
  });

  it("keeps an offline account's equity and doesn't count a new account as profit", async () => {
    const account = await mt5Account();
    await getStore().brokers.update(account.id, { equity: 0, last_sync_at: null, status: "waiting" });
    await runEngineTick(); // starts the live day at 0
    await ingestMt5Report((await getStore().brokers.get(account.id))!, {
      login: "1", server: "", company: "", currency: "USD", balance: 1000, equity: 1000, is_demo: true, positions: [], deals: [], results: [],
    });
    expect((await getSettings()).books.live.day_start_equity).toBe(1000);

    await getStore().brokers.update(account.id, { status: "waiting" });
    expect(await bookEquity("live")).toBe(1000);
  });

  it("tracks positions from other EAs as external trades", async () => {
    const account = await mt5Account();
    await ingestMt5Report(account, {
      login: "1", server: "", company: "", currency: "USD", balance: 1, equity: 1, is_demo: true, deals: [], results: [],
      positions: [{ ticket: "9", symbol: "XAUUSDm", type: "sell", volume: 0.01, price_open: 2400, price_current: 2390, sl: 0, tp: 0, profit: 10, magic: 42, comment: "" }],
    });
    const [trade] = await activeTrades();
    expect(trade).toMatchObject({ external: true, symbol: "XAUUSDm", magic: 42 });
  });
});
