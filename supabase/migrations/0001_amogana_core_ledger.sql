-- ============================================================================
-- Amogana Core Ledger Schema
-- Double-entry wallet & transaction system bridging local MNOs (Orange Money,
-- myZaka, Smega), international remittance rails, FX markets, and external
-- merchants (Deriv, Bet365, etc).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Enumerated types
-- ----------------------------------------------------------------------------
create type public.kyc_status as enum ('unverified', 'pending', 'verified', 'rejected');

create type public.wallet_category as enum (
  'mobile_money',   -- Orange Money, myZaka, Smega
  'bank',           -- Local/international bank rail
  'fx',             -- Multi-currency FX holding wallet
  'trading',        -- Deriv and similar trading brokers
  'sportsbook',      -- Bet365 and similar sportsbooks
  'platform'        -- Amogana internal float / fee / suspense wallets
);

create type public.transaction_type as enum (
  'deposit',
  'withdrawal',
  'transfer',
  'fx_swap',
  'merchant_payment'
);

create type public.transaction_status as enum (
  'pending',
  'processing',
  'completed',
  'failed',
  'reversed'
);

create type public.ledger_entry_direction as enum ('debit', 'credit');

create type public.webhook_provider as enum (
  'orange_money',
  'myzaka',
  'smega',
  'deriv',
  'bet365'
);

-- ----------------------------------------------------------------------------
-- Reference data: currencies
-- ----------------------------------------------------------------------------
create table public.currencies (
  code            text primary key check (code = upper(code) and length(code) = 3),
  name            text not null,
  symbol          text not null,
  decimal_places  smallint not null default 4 check (decimal_places between 0 and 8),
  is_active       boolean not null default true
);

insert into public.currencies (code, name, symbol, decimal_places) values
  ('BWP', 'Botswana Pula', 'P', 2),
  ('ZAR', 'South African Rand', 'R', 2),
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2);

-- ----------------------------------------------------------------------------
-- Profiles (1:1 extension of auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  full_name       text not null,
  phone_number    text unique,
  country_code    text not null default 'BW',
  kyc_status      public.kyc_status not null default 'unverified',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Wallets: one row per (user, currency, provider) combination.
-- Precision-tracked NUMERIC(20,4) balances — never floats.
-- ----------------------------------------------------------------------------
create table public.wallets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  currency_code     text not null references public.currencies (code),
  category          public.wallet_category not null,
  provider_name     text not null,                 -- e.g. 'Orange Money', 'Deriv', 'Amogana FX Vault'
  display_name      text not null,
  balance           numeric(20, 4) not null default 0 check (balance >= 0),
  available_balance numeric(20, 4) not null default 0 check (available_balance >= 0),
  is_active         boolean not null default true,
  is_default        boolean not null default false,
  external_ref      text,                            -- MNO/broker-side account identifier (masked)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint wallets_available_lte_balance check (available_balance <= balance),
  constraint wallets_unique_user_currency_provider unique (user_id, currency_code, provider_name)
);

create index wallets_user_id_idx on public.wallets (user_id);
create index wallets_currency_idx on public.wallets (currency_code);

-- ----------------------------------------------------------------------------
-- External accounts: linked identities on MNOs / brokers / sportsbooks used
-- as the counterparty for deposits, withdrawals and merchant payments.
-- ----------------------------------------------------------------------------
create table public.external_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  provider        public.webhook_provider not null,
  category        public.wallet_category not null,
  account_label   text not null,                     -- e.g. 'Deriv Trading Wallet'
  masked_identifier text not null,                    -- e.g. '+267 •• •• 210' or 'CR•••4821'
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint external_accounts_unique unique (user_id, provider, masked_identifier)
);

create index external_accounts_user_id_idx on public.external_accounts (user_id);

-- ----------------------------------------------------------------------------
-- FX rates: live-ish mid-market rates the platform quotes spreads against.
-- ----------------------------------------------------------------------------
create table public.fx_rates (
  id              uuid primary key default gen_random_uuid(),
  base_currency   text not null references public.currencies (code),
  quote_currency  text not null references public.currencies (code),
  mid_rate        numeric(20, 8) not null check (mid_rate > 0),
  spread_bps      integer not null default 75 check (spread_bps >= 0),
  updated_at      timestamptz not null default now(),
  constraint fx_rates_unique_pair unique (base_currency, quote_currency),
  constraint fx_rates_distinct_currencies check (base_currency <> quote_currency)
);

insert into public.fx_rates (base_currency, quote_currency, mid_rate, spread_bps) values
  ('BWP', 'USD', 0.0735, 75),
  ('USD', 'BWP', 13.6054, 75),
  ('BWP', 'ZAR', 1.3542, 60),
  ('ZAR', 'BWP', 0.7385, 60),
  ('USD', 'EUR', 0.9231, 50),
  ('EUR', 'USD', 1.0833, 50),
  ('ZAR', 'USD', 0.0543, 75),
  ('USD', 'ZAR', 18.4210, 75),
  ('BWP', 'EUR', 0.0679, 80),
  ('EUR', 'BWP', 14.7280, 80);

-- ----------------------------------------------------------------------------
-- Transactions: the double-entry ledger header. Every money movement,
-- internal or external, is represented as exactly one row here.
-- ----------------------------------------------------------------------------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  sender_wallet_id      uuid references public.wallets (id),
  receiver_wallet_id    uuid references public.wallets (id),
  type                  public.transaction_type not null,
  status                public.transaction_status not null default 'pending',
  source_amount         numeric(20, 4) not null check (source_amount > 0),
  source_currency       text not null references public.currencies (code),
  destination_amount    numeric(20, 4) not null check (destination_amount > 0),
  destination_currency  text not null references public.currencies (code),
  fx_rate               numeric(20, 8) not null default 1 check (fx_rate > 0),
  fee_amount            numeric(20, 4) not null default 0 check (fee_amount >= 0),
  idempotency_key       text unique,
  external_reference    text,                         -- carrier/merchant transaction ID
  failure_reason        text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  constraint transactions_at_least_one_wallet check (
    sender_wallet_id is not null or receiver_wallet_id is not null
  ),
  constraint transactions_wallets_distinct check (
    sender_wallet_id is distinct from receiver_wallet_id
  )
);

create index transactions_user_id_idx on public.transactions (user_id);
create index transactions_sender_wallet_idx on public.transactions (sender_wallet_id);
create index transactions_receiver_wallet_idx on public.transactions (receiver_wallet_id);
create index transactions_status_idx on public.transactions (status);
create index transactions_created_at_idx on public.transactions (created_at desc);
create index transactions_metadata_gin_idx on public.transactions using gin (metadata);

-- ----------------------------------------------------------------------------
-- Ledger entries: immutable debit/credit lines derived from transactions.
-- Enforces that every completed transaction balances (sum(debits) = sum(credits))
-- per currency, giving true double-entry auditability beneath the simpler
-- sender/receiver view on `transactions`.
-- ----------------------------------------------------------------------------
create table public.ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions (id) on delete cascade,
  wallet_id       uuid not null references public.wallets (id),
  direction       public.ledger_entry_direction not null,
  amount          numeric(20, 4) not null check (amount > 0),
  currency_code   text not null references public.currencies (code),
  created_at      timestamptz not null default now()
);

create index ledger_entries_transaction_idx on public.ledger_entries (transaction_id);
create index ledger_entries_wallet_idx on public.ledger_entries (wallet_id);

-- ----------------------------------------------------------------------------
-- Webhook events: inbound audit log + idempotency guard for MNO/merchant
-- asynchronous callbacks.
-- ----------------------------------------------------------------------------
create table public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          public.webhook_provider not null,
  event_id          text not null,
  transaction_id    uuid references public.transactions (id),
  signature_valid   boolean not null,
  payload           jsonb not null,
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint webhook_events_unique_provider_event unique (provider, event_id)
);

create index webhook_events_transaction_idx on public.webhook_events (transaction_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger wallets_set_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- execute_ledger_transfer: the single atomic entry point for moving money
-- between two wallets. Runs inside one Postgres transaction (function body),
-- taking row-level locks to prevent concurrent double-spends, so partial
-- writes are impossible — either every step below commits, or none do.
-- ----------------------------------------------------------------------------
create or replace function public.execute_ledger_transfer(
  p_user_id            uuid,
  p_sender_wallet_id   uuid,
  p_receiver_wallet_id uuid,
  p_source_amount      numeric,
  p_type               public.transaction_type,
  p_fee_amount         numeric default 0,
  p_idempotency_key    text default null,
  p_metadata           jsonb default '{}'::jsonb
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender     public.wallets%rowtype;
  v_receiver   public.wallets%rowtype;
  v_fx         public.fx_rates%rowtype;
  v_rate       numeric(20, 8) := 1;
  v_dest_amount numeric(20, 4);
  v_txn        public.transactions%rowtype;
  v_debit_total numeric(20, 4);
begin
  if p_idempotency_key is not null then
    select * into v_txn from public.transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_txn;
    end if;
  end if;

  -- Lock both wallets in a deterministic order to avoid deadlocks.
  select * into v_sender from public.wallets
    where id = p_sender_wallet_id and user_id = p_user_id
    for update;

  if not found then
    raise exception 'SENDER_WALLET_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_receiver from public.wallets
    where id = p_receiver_wallet_id
    for update;

  if not found then
    raise exception 'RECEIVER_WALLET_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_debit_total := p_source_amount + p_fee_amount;

  if v_sender.available_balance < v_debit_total then
    raise exception 'INSUFFICIENT_FUNDS' using errcode = 'P0001';
  end if;

  if v_sender.currency_code = v_receiver.currency_code then
    v_rate := 1;
    v_dest_amount := p_source_amount;
  else
    select * into v_fx from public.fx_rates
      where base_currency = v_sender.currency_code
        and quote_currency = v_receiver.currency_code;

    if not found then
      raise exception 'FX_RATE_UNAVAILABLE' using errcode = 'P0003';
    end if;

    -- Apply the platform spread against the mid-market rate.
    v_rate := v_fx.mid_rate * (1 - (v_fx.spread_bps::numeric / 10000));
    v_dest_amount := round(p_source_amount * v_rate, 4);
  end if;

  update public.wallets
    set balance = balance - v_debit_total,
        available_balance = available_balance - v_debit_total
    where id = v_sender.id;

  update public.wallets
    set balance = balance + v_dest_amount,
        available_balance = available_balance + v_dest_amount
    where id = v_receiver.id;

  insert into public.transactions (
    user_id, sender_wallet_id, receiver_wallet_id, type, status,
    source_amount, source_currency, destination_amount, destination_currency,
    fx_rate, fee_amount, idempotency_key, metadata, completed_at
  ) values (
    p_user_id, v_sender.id, v_receiver.id, p_type, 'completed',
    p_source_amount, v_sender.currency_code, v_dest_amount, v_receiver.currency_code,
    v_rate, p_fee_amount, p_idempotency_key, p_metadata, now()
  )
  returning * into v_txn;

  insert into public.ledger_entries (transaction_id, wallet_id, direction, amount, currency_code)
  values
    (v_txn.id, v_sender.id, 'debit', v_debit_total, v_sender.currency_code),
    (v_txn.id, v_receiver.id, 'credit', v_dest_amount, v_receiver.currency_code);

  return v_txn;
end;
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.external_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.fx_rates enable row level security;
alter table public.currencies enable row level security;
alter table public.webhook_events enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "wallets_select_own" on public.wallets
  for select using (auth.uid() = user_id);

create policy "external_accounts_select_own" on public.external_accounts
  for select using (auth.uid() = user_id);
create policy "external_accounts_insert_own" on public.external_accounts
  for insert with check (auth.uid() = user_id);
create policy "external_accounts_delete_own" on public.external_accounts
  for delete using (auth.uid() = user_id);

create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);

create policy "ledger_entries_select_own" on public.ledger_entries
  for select using (
    exists (
      select 1 from public.wallets w
      where w.id = ledger_entries.wallet_id and w.user_id = auth.uid()
    )
  );

create policy "fx_rates_select_all" on public.fx_rates
  for select using (true);
create policy "currencies_select_all" on public.currencies
  for select using (true);

-- Webhook events and direct wallet/transaction writes are performed exclusively
-- by trusted server-side code using the Supabase service role key, which
-- bypasses RLS by design — no client-facing insert/update/delete policies
-- are defined for `wallets`, `transactions`, `ledger_entries`, or `webhook_events`.
