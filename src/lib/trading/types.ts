// Field names are snake_case so rows map 1:1 onto the Supabase tables in
// supabase/migrations/0001_amogana_autotrade.sql.

/** Whether money is real or demo — always taken from the broker account (see bookOf). */
export type Book = "real" | "demo";
export type Side = "buy" | "sell";
export type BrokerKind = "deriv" | "mt5";

export interface BrokerAccount {
  id: string;
  kind: BrokerKind;
  label: string;
  status: "connected" | "waiting" | "error";
  login: string | null;
  server: string | null;
  currency: string;
  balance: number;
  equity: number;
  is_demo: boolean;
  /** AES-GCM encrypted Deriv Personal Access Token (Deriv accounts only). */
  encrypted_token: string | null;
  /** App ID of the user's registered Deriv app, sent as Deriv-App-ID (Deriv accounts only). */
  app_id: string | null;
  /** SHA-256 of the MT5 bridge key (MT5 accounts only). The key itself is shown once. */
  bridge_key_hash: string | null;
  last_sync_at: string | null;
  error: string | null;
  created_at: string;
}

export type BotSource = "builtin" | "tradingview";
export type BotStatus = "running" | "paused";

export interface StrategyConfig {
  id: string;
  params: Record<string, number>;
}

export interface Bot {
  id: string;
  name: string;
  source: BotSource;
  /** Required to trade; null only after its account was disconnected. */
  broker_account_id: string | null;
  /** Symbol as the broker names it, e.g. "EURUSDm" on Exness or "frxEURUSD" / "R_75" on Deriv. */
  symbol: string;
  /** Deriv symbol the strategy reads candles from, e.g. "frxEURUSD". */
  data_symbol: string;
  timeframe: number; // seconds per candle
  strategy: StrategyConfig | null;
  status: BotStatus;
  paused_reason: string | null;
  risk_percent: number;
  /** Deriv multiplier contracts only. */
  deriv_multiplier: number;
  /** MT5 magic number stamped on every order this bot sends. */
  magic: number;
  /** Shared secret a TradingView alert must include. */
  webhook_passphrase: string;
  last_bar_epoch: number | null;
  last_signal_at: string | null;
  created_at: string;
}

export type TradeStatus = "pending" | "open" | "closed" | "rejected";

export interface Trade {
  id: string;
  bot_id: string | null;
  broker_account_id: string | null;
  book: Book;
  symbol: string;
  data_symbol: string | null;
  side: Side;
  /** Lots on MT5, stake on Deriv. */
  size: number;
  size_unit: "lots" | "stake";
  entry_price: number | null;
  current_price: number | null;
  sl: number | null;
  tp: number | null;
  risk_amount: number;
  pnl: number;
  status: TradeStatus;
  broker_ref: string | null;
  magic: number | null;
  /** True for positions opened outside binaryTrades (e.g. your own EA) and seen through the MT5 bridge. */
  external: boolean;
  close_reason: string | null;
  exit_price: number | null;
  opened_at: string;
  closed_at: string | null;
}

export type SignalAction = "buy" | "sell" | "close";

export interface Signal {
  id: string;
  bot_id: string | null;
  source: BotSource | "manual";
  action: SignalAction;
  symbol: string | null;
  price: number | null;
  sl: number | null;
  tp: number | null;
  external_id: string | null;
  status: "accepted" | "rejected" | "duplicate";
  reason: string | null;
  received_at: string;
}

export type Mt5CommandType = "open" | "close" | "close_all";

export interface Mt5Command {
  id: string;
  account_id: string;
  trade_id: string | null;
  type: Mt5CommandType;
  payload: Record<string, unknown>;
  status: "queued" | "sent" | "done" | "failed";
  result: Record<string, unknown> | null;
  created_at: string;
  sent_at: string | null;
}

export interface EventLog {
  id: string;
  level: "info" | "warn" | "error" | "trade";
  message: string;
  bot_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
}

export interface EquityPoint {
  id: string;
  book: Book;
  equity: number;
  created_at: string;
}

export interface BookState {
  peak_equity: number;
  day_key: string;
  day_start_equity: number;
}

export interface Settings {
  id: "global";
  kill_switch: boolean;
  /** Max loss per day, in account currency, before every bot in that book pauses. */
  daily_loss_limit: number;
  /** Max drop from the equity peak, in percent, before the kill switch engages. */
  max_drawdown_percent: number;
  max_open_trades: number;
  max_trades_per_bot: number;
  default_risk_percent: number;
  books: Record<Book, BookState>;
  updated_at: string;
}
