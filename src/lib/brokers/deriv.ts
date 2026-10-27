import "server-only";

import WebSocket from "ws";

/**
 * Minimal Deriv WebSocket API client (https://developers.deriv.com).
 *
 * Each call opens a short-lived connection, optionally authorises with the
 * user's API token, runs its requests and closes. Trading uses Multiplier
 * contracts (MULTUP / MULTDOWN), which work on Deriv forex, commodities,
 * crypto and synthetic indices and support stop-loss / take-profit amounts.
 *
 * Create the token at app.deriv.com → Settings → API token with the
 * "Read" and "Trade" scopes only. Never grant "Payments" or "Admin".
 */

const DEFAULT_APP_ID = "1089"; // Deriv's public testing app id; register your own for production.

function endpoint(): string {
  const base = process.env.DERIV_WS_URL ?? "wss://ws.derivws.com/websockets/v3";
  return `${base}?app_id=${process.env.DERIV_APP_ID ?? DEFAULT_APP_ID}`;
}

export class DerivError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

class DerivSession {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      let msg: Json;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const id = msg.req_id as number | undefined;
      const waiter = id !== undefined ? this.pending.get(id) : undefined;
      if (!waiter) return;
      this.pending.delete(id!);
      const error = msg.error as { message?: string; code?: string } | undefined;
      if (error) waiter.reject(new DerivError(error.message ?? "Deriv API error", error.code));
      else waiter.resolve(msg);
    });
    const failAll = (err: Error) => {
      for (const w of this.pending.values()) w.reject(err);
      this.pending.clear();
    };
    ws.on("close", () => failAll(new DerivError("Deriv connection closed")));
    ws.on("error", (e) => failAll(new DerivError(`Deriv connection error: ${e.message}`)));
  }

  send<T = Json>(request: Json, timeoutMs = 15000): Promise<T> {
    const req_id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(new DerivError(`Deriv request timed out: ${Object.keys(request)[0]}`));
      }, timeoutMs);
      this.pending.set(req_id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ ...request, req_id }));
    });
  }
}

export async function withDeriv<T>(token: string | null, fn: (s: DerivSession) => Promise<T>): Promise<T> {
  const ws = new WebSocket(endpoint());
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DerivError("Could not reach Deriv (timeout)")), 10000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (e) => {
      clearTimeout(timer);
      reject(new DerivError(`Could not reach Deriv: ${e.message}`));
    });
  });
  const session = new DerivSession(ws);
  try {
    if (token) await session.send({ authorize: token });
    return await fn(session);
  } finally {
    ws.close();
  }
}

// ---------------------------------------------------------------------------
// Account

export interface DerivAccountInfo {
  loginid: string;
  currency: string;
  balance: number;
  is_virtual: boolean;
  scopes: string[];
}

export async function derivAuthorize(token: string): Promise<DerivAccountInfo> {
  return withDeriv(null, async (s) => {
    const res = await s.send<{ authorize: Json }>({ authorize: token });
    const a = res.authorize;
    return {
      loginid: String(a.loginid),
      currency: String(a.currency || "USD"),
      balance: Number(a.balance ?? 0),
      is_virtual: Boolean(a.is_virtual),
      scopes: (a.scopes as string[]) ?? [],
    };
  });
}

export interface DerivOpenContract {
  contract_id: string;
  symbol: string;
  side: "buy" | "sell";
  stake: number;
  profit: number;
  entry_spot: number | null;
  current_spot: number | null;
  is_sold: boolean;
  sell_price: number | null;
  exit_spot: number | null;
}

function toOpenContract(poc: Json): DerivOpenContract {
  return {
    contract_id: String(poc.contract_id),
    symbol: String(poc.underlying ?? ""),
    side: poc.contract_type === "MULTDOWN" ? "sell" : "buy",
    stake: Number(poc.buy_price ?? 0),
    profit: Number(poc.profit ?? 0),
    entry_spot: poc.entry_spot != null ? Number(poc.entry_spot) : null,
    current_spot: poc.current_spot != null ? Number(poc.current_spot) : null,
    is_sold: Boolean(poc.is_sold),
    sell_price: poc.sell_price != null ? Number(poc.sell_price) : null,
    exit_spot: poc.exit_tick != null ? Number(poc.exit_tick) : null,
  };
}

/** Balance plus every open Multiplier contract with live profit. */
export async function derivSnapshot(
  token: string,
  trackedContractIds: string[],
): Promise<{ balance: number; currency: string; equity: number; contracts: DerivOpenContract[] }> {
  return withDeriv(token, async (s) => {
    const bal = await s.send<{ balance: { balance: number; currency: string } }>({ balance: 1 });
    const portfolio = await s.send<{ portfolio: { contracts: Json[] } }>({ portfolio: 1 });
    const ids = new Set([
      ...portfolio.portfolio.contracts
        .filter((c) => String(c.contract_type).startsWith("MULT"))
        .map((c) => String(c.contract_id)),
      ...trackedContractIds,
    ]);
    const contracts: DerivOpenContract[] = [];
    for (const id of ids) {
      const res = await s.send<{ proposal_open_contract: Json }>({ proposal_open_contract: 1, contract_id: Number(id) });
      contracts.push(toOpenContract(res.proposal_open_contract));
    }
    const openValue = contracts.filter((c) => !c.is_sold).reduce((sum, c) => sum + c.stake + c.profit, 0);
    return {
      balance: Number(bal.balance.balance),
      currency: bal.balance.currency,
      equity: Number(bal.balance.balance) + openValue,
      contracts,
    };
  });
}

// ---------------------------------------------------------------------------
// Trading

export interface DerivOrder {
  symbol: string;
  side: "buy" | "sell";
  stake: number;
  multiplier: number;
  currency: string;
  /** Loss (in account currency) at which Deriv closes the contract. */
  stopLossAmount?: number;
  /** Profit (in account currency) at which Deriv closes the contract. */
  takeProfitAmount?: number;
}

export async function derivOpen(
  token: string,
  order: DerivOrder,
): Promise<{ contract_id: string; buy_price: number; entry_spot: number | null }> {
  const round = (n: number) => Math.round(n * 100) / 100;
  const limit_order: Json = {};
  if (order.stopLossAmount) limit_order.stop_loss = round(Math.min(order.stopLossAmount, order.stake));
  if (order.takeProfitAmount) limit_order.take_profit = round(order.takeProfitAmount);

  return withDeriv(token, async (s) => {
    const res = await s.send<{ buy: Json }>({
      buy: 1,
      price: round(order.stake),
      parameters: {
        amount: round(order.stake),
        basis: "stake",
        contract_type: order.side === "buy" ? "MULTUP" : "MULTDOWN",
        currency: order.currency,
        multiplier: order.multiplier,
        symbol: order.symbol,
        ...(Object.keys(limit_order).length ? { limit_order } : {}),
      },
    });
    const contractId = String(res.buy.contract_id);
    let entry: number | null = null;
    try {
      const poc = await s.send<{ proposal_open_contract: Json }>({
        proposal_open_contract: 1,
        contract_id: Number(contractId),
      });
      entry = toOpenContract(poc.proposal_open_contract).entry_spot;
    } catch {
      // Entry spot is cosmetic; the next sync fills it in.
    }
    return { contract_id: contractId, buy_price: Number(res.buy.buy_price), entry_spot: entry };
  });
}

export async function derivClose(token: string, contractId: string): Promise<{ sold_for: number }> {
  return withDeriv(token, async (s) => {
    const res = await s.send<{ sell: { sold_for: number } }>({ sell: Number(contractId), price: 0 });
    return { sold_for: Number(res.sell.sold_for) };
  });
}

// ---------------------------------------------------------------------------
// Market data (public, no token needed)

export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const DERIV_GRANULARITIES = [60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400] as const;

export async function derivCandles(symbol: string, granularity: number, count: number): Promise<Candle[]> {
  return withDeriv(null, async (s) => {
    const res = await s.send<{ candles: Json[] }>({
      ticks_history: symbol,
      end: "latest",
      count: Math.min(Math.max(count, 1), 5000),
      style: "candles",
      granularity,
      adjust_start_time: 1,
    });
    return (res.candles ?? []).map((c) => ({
      epoch: Number(c.epoch),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
  });
}
