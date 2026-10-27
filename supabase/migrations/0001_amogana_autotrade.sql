-- Amogana auto-trading schema.
--
-- Only the server talks to these tables, using the service-role key
-- (src/lib/trading/store.ts). RLS is enabled with no policies so the anon
-- key and browser clients can read or write nothing.

create table if not exists settings (
  id text primary key default 'global',
  kill_switch boolean not null default false,
  daily_loss_limit numeric not null default 250,
  max_drawdown_percent numeric not null default 15,
  max_open_trades integer not null default 8,
  max_trades_per_bot integer not null default 1,
  default_risk_percent numeric not null default 1,
  paper_starting_balance numeric not null default 10000,
  books jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists brokers (
  id text primary key,
  kind text not null check (kind in ('deriv', 'mt5')),
  label text not null,
  status text not null check (status in ('connected', 'waiting', 'error')),
  login text,
  server text,
  currency text not null default 'USD',
  balance numeric not null default 0,
  equity numeric not null default 0,
  is_demo boolean not null default false,
  encrypted_token text,
  bridge_key_hash text unique,
  last_sync_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists bots (
  id text primary key,
  name text not null,
  source text not null check (source in ('builtin', 'tradingview')),
  broker_account_id text references brokers (id) on delete set null,
  book text not null check (book in ('paper', 'live')),
  symbol text not null,
  data_symbol text not null,
  timeframe integer not null,
  strategy jsonb,
  status text not null check (status in ('running', 'paused')),
  paused_reason text,
  risk_percent numeric not null,
  deriv_multiplier integer not null default 100,
  magic integer not null,
  webhook_passphrase text not null,
  last_bar_epoch bigint,
  last_signal_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists trades (
  id text primary key,
  bot_id text references bots (id) on delete set null,
  broker_account_id text references brokers (id) on delete set null,
  book text not null check (book in ('paper', 'live')),
  symbol text not null,
  data_symbol text,
  side text not null check (side in ('buy', 'sell')),
  size numeric not null,
  size_unit text not null check (size_unit in ('lots', 'stake', 'units')),
  entry_price numeric,
  current_price numeric,
  sl numeric,
  tp numeric,
  risk_amount numeric not null default 0,
  pnl numeric not null default 0,
  status text not null check (status in ('pending', 'open', 'closed', 'rejected')),
  broker_ref text,
  magic integer,
  external boolean not null default false,
  close_reason text,
  exit_price numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists trades_status_idx on trades (status);
create index if not exists trades_bot_idx on trades (bot_id);
create index if not exists trades_broker_idx on trades (broker_account_id, status);

create table if not exists signals (
  id text primary key,
  bot_id text references bots (id) on delete set null,
  source text not null,
  action text not null,
  symbol text,
  price numeric,
  sl numeric,
  tp numeric,
  external_id text,
  status text not null,
  reason text,
  received_at timestamptz not null default now()
);
create index if not exists signals_dedup_idx on signals (bot_id, external_id);
create index if not exists signals_received_idx on signals (received_at desc);

create table if not exists commands (
  id text primary key,
  account_id text not null references brokers (id) on delete cascade,
  trade_id text references trades (id) on delete set null,
  type text not null check (type in ('open', 'close', 'close_all')),
  payload jsonb not null default '{}',
  status text not null check (status in ('queued', 'sent', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists commands_queue_idx on commands (account_id, status);

create table if not exists logs (
  id text primary key,
  level text not null,
  message text not null,
  bot_id text references bots (id) on delete set null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists logs_created_idx on logs (created_at desc);

create table if not exists equity (
  id text primary key,
  book text not null check (book in ('paper', 'live')),
  equity numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists equity_book_idx on equity (book, created_at);

alter table settings enable row level security;
alter table brokers enable row level security;
alter table bots enable row level security;
alter table trades enable row level security;
alter table signals enable row level security;
alter table commands enable row level security;
alter table logs enable row level security;
alter table equity enable row level security;
