import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ingestMt5Report, type Mt5Report } from "@/lib/brokers/mt5";
import { encryptSecret } from "@/lib/secrets";
import { activeTrades, bookEquity, deps, processSignal, runEngineTick, setKillSwitch } from "@/lib/trading/engine";
import { getSettings, getStore, newId, nowIso, resetStore, updateSettings } from "@/lib/trading/store";
import type { Bot, BrokerAccount } from "@/lib/trading/types";

// ---------------------------------------------------------------------------
// Fake Deriv: contracts live in memory; equity is set per test.

let price = 1.1;
let derivEquity: Record<string, number> = {};
let contracts: Array<{ id: string; stake: number; side: "buy" | "sell"; sold: boolean }> = [];

deps.candles = async (_symbol, granularity, count) =>
  Array.from({ length: count }, (_, i) => ({
    epoch: Math.floor(Date.now() / 1000) - (count - i) * granularity,
    open: price,
    high: price,
    low: price,
    close: price,
  }));
deps.derivOpen = async (_cred, order) => {
  const id = `c${contracts.length + 1}`;
  contracts.push({ id, stake: order.stake, side: order.side, sold: false });
  return { contract_id: id, buy_price: order.stake, entry_spot: price };
};
deps.derivClose = async (_token, id) => {
  const c = contracts.find((x) => x.id === id)!;
  c.sold = true;
  return { sold_for: c.stake + 5 };
};
deps.derivSnapshot = async (cred) => ({
  balance: derivEquity[cred.token] ?? 0,
  currency: "USD",
  equity: derivEquity[cred.token] ?? 0,
  contracts: [],
});

async function derivAccount(token: string, isDemo: boolean, equity: number): Promise<BrokerAccount> {
  derivEquity[token] = equity;
  const account: BrokerAccount = {
    id: newId(), kind: "deriv", label: isDemo ? "Deriv demo" : "Deriv real", status: "connected", login: token,
    server: null, currency: "USD", balance: equity, equity, is_demo: isDemo, encrypted_token: encryptSecret(token), app_id: "12345",
    bridge_key_hash: null, last_sync_at: nowIso(), error: null, created_at: nowIso(),
  };
  await getStore().brokers.insert(account);
  return account;
}

function makeBot(patch: Partial<Bot> = {}): Bot {
  return {
    id: newId(),
    name: "Test bot",
    source: "tradingview",
    broker_account_id: null,
    symbol: "frxEURUSD",
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
  derivEquity = {};
  contracts = [];
});

describe("trading engine", () => {
  it("trades on the bot's account and takes real/demo from that account", async () => {
    const demo = await derivAccount("demo-token", true, 1000);
    const bot = makeBot({ broker_account_id: demo.id });
    await getStore().bots.insert(bot);

    const s1 = await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.089 });
    expect(s1.status).toBe("accepted");
    const [long] = await activeTrades({ bot_id: bot.id });
    expect(long).toMatchObject({ book: "demo", size_unit: "stake", broker_ref: "c1", broker_account_id: demo.id });
    // $10 risk (1% of 1000) over a 1% stop at ×100 → $10 stake.
    expect(long!.size).toBeCloseTo(10);

    const s2 = await processSignal({ bot, source: "tradingview", action: "sell", price: 1.1, sl: 1.111 });
    expect(s2.status).toBe("accepted");
    const closed = await getStore().trades.all({ eq: { status: "closed" } });
    expect(closed[0]!.pnl).toBeCloseTo(5);
    expect((await activeTrades({ bot_id: bot.id }))[0]!.side).toBe("sell");
  });

  it("refuses to trade without a broker account", async () => {
    const bot = makeBot();
    await getStore().bots.insert(bot);
    const s = await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1 });
    expect(s).toMatchObject({ status: "rejected" });
    expect(s.reason).toMatch(/no broker account/i);
  });

  it("ignores duplicate alerts and paused bots", async () => {
    const demo = await derivAccount("t", true, 1000);
    const bot = makeBot({ broker_account_id: demo.id });
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, external_id: "a" });
    expect((await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, external_id: "a" })).status).toBe("duplicate");

    const paused = makeBot({ status: "paused", broker_account_id: demo.id });
    await getStore().bots.insert(paused);
    expect((await processSignal({ bot: paused, source: "tradingview", action: "buy", price: 1.1 })).status).toBe("rejected");
  });

  it("a demo loss pauses demo bots only; real bots keep running", async () => {
    await updateSettings({ daily_loss_limit: 50 });
    const demo = await derivAccount("demo", true, 1000);
    const real = await derivAccount("real", false, 1000);
    const demoBot = makeBot({ broker_account_id: demo.id });
    const realBot = makeBot({ broker_account_id: real.id });
    await getStore().bots.insert(demoBot);
    await getStore().bots.insert(realBot);

    await runEngineTick(); // starts both days at 1000
    derivEquity.demo = 900;
    await runEngineTick();

    expect((await getStore().bots.get(demoBot.id))!.status).toBe("paused");
    expect((await getStore().bots.get(realBot.id))!.status).toBe("running");
    expect((await getSettings()).kill_switch).toBe(false);
  });

  it("a real-account drawdown fires the kill switch; a demo one does not", async () => {
    await updateSettings({ daily_loss_limit: 0, max_drawdown_percent: 10 });
    const demo = await derivAccount("demo", true, 1000);
    await runEngineTick();
    derivEquity.demo = 800;
    await runEngineTick();
    expect((await getSettings()).kill_switch).toBe(false);

    await derivAccount("real", false, 1000);
    await runEngineTick();
    derivEquity.real = 850;
    await runEngineTick();
    expect((await getSettings()).kill_switch).toBe(true);
    expect(demo).toBeTruthy();
  });

  it("kill switch pauses everything and closes positions", async () => {
    const demo = await derivAccount("t", true, 1000);
    const bot = makeBot({ broker_account_id: demo.id });
    await getStore().bots.insert(bot);
    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1 });
    await setKillSwitch(true);
    expect(await activeTrades()).toHaveLength(0);
    expect((await getStore().bots.get(bot.id))!.status).toBe("paused");
  });
});

describe("MT5 bridge", () => {
  async function mt5Account(patch: Partial<BrokerAccount> = {}): Promise<BrokerAccount> {
    const account: BrokerAccount = {
      id: newId(), kind: "mt5", label: "Exness MT5", status: "connected", login: null, server: null,
      currency: "USD", balance: 1000, equity: 1000, is_demo: true, encrypted_token: null, app_id: null,
      bridge_key_hash: "x", last_sync_at: nowIso(), error: null, created_at: nowIso(), ...patch,
    };
    await getStore().brokers.insert(account);
    return account;
  }

  const report: Mt5Report = {
    login: "123", server: "Exness-MT5Trial", company: "Exness", currency: "USD", balance: 1000, equity: 1000, is_demo: true,
    positions: [], deals: [], results: [],
  };

  it("queues an order, links the fill and books the close", async () => {
    const account = await mt5Account();
    const bot = makeBot({ broker_account_id: account.id, symbol: "EURUSDm" });
    await getStore().bots.insert(bot);

    await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1, sl: 1.09 });
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
    expect(trade).toMatchObject({ status: "open", broker_ref: "555", pnl: 10, book: "demo" });

    await ingestMt5Report(account, { ...report, deals: [{ position_id: "555", profit: 25, price: 1.1026 }] });
    [trade] = await getStore().trades.all({ eq: { bot_id: bot.id } });
    expect(trade).toMatchObject({ status: "closed", pnl: 25 });
  });

  it("files a new account under its own kind without counting it as profit, and keeps it when offline", async () => {
    const account = await mt5Account({ equity: 0, last_sync_at: null, status: "waiting", is_demo: false });
    await runEngineTick(); // starts both days at 0
    await ingestMt5Report((await getStore().brokers.get(account.id))!, { ...report, is_demo: true });
    const settings = await getSettings();
    expect(settings.books.demo.day_start_equity).toBe(1000);
    expect(settings.books.real.day_start_equity).toBe(0);

    await getStore().brokers.update(account.id, { status: "waiting" });
    expect(await bookEquity("demo")).toBe(1000);
    expect(await bookEquity("real")).toBe(0);
  });

  it("tracks positions from other EAs as external trades", async () => {
    const account = await mt5Account({ is_demo: false });
    await ingestMt5Report(account, {
      ...report,
      is_demo: false,
      positions: [{ ticket: "9", symbol: "XAUUSDm", type: "sell", volume: 0.01, price_open: 2400, price_current: 2390, sl: 0, tp: 0, profit: 10, magic: 42, comment: "" }],
    });
    const [trade] = await activeTrades();
    expect(trade).toMatchObject({ external: true, symbol: "XAUUSDm", magic: 42, book: "real" });
  });
});

describe("Deriv credentials", () => {
  it("passes the decrypted token, App ID and account to Deriv calls", async () => {
    const seen: unknown[] = [];
    const original = deps.derivOpen;
    deps.derivOpen = async (cred, order) => {
      seen.push(cred);
      return original(cred, order);
    };
    try {
      const demo = await derivAccount("pat-123", true, 1000);
      const bot = makeBot({ broker_account_id: demo.id });
      await getStore().bots.insert(bot);
      await processSignal({ bot, source: "tradingview", action: "buy", price: 1.1 });
      expect(seen).toEqual([{ token: "pat-123", appId: "12345", accountId: "pat-123" }]);
    } finally {
      deps.derivOpen = original;
    }
  });
});
