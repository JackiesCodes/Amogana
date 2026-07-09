-- ============================================================================
-- Amogana External Settlement Functions
-- Handles the two-phase lifecycle of money movements that originate outside
-- Amogana (MNO deposits, merchant payouts): create a `pending` transaction
-- when the user initiates the action, then atomically settle it once the
-- external provider's webhook confirms success.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_pending_settlement: opens a pending transaction for a deposit,
-- withdrawal, or merchant payment that requires external confirmation.
-- No balances move yet — funds are only recognised once the webhook lands.
-- ----------------------------------------------------------------------------
create or replace function public.create_pending_settlement(
  p_user_id             uuid,
  p_wallet_id           uuid,
  p_type                public.transaction_type,
  p_source_amount       numeric,
  p_destination_amount  numeric,
  p_source_currency     text,
  p_destination_currency text,
  p_fx_rate             numeric default 1,
  p_fee_amount          numeric default 0,
  p_external_reference  text default null,
  p_idempotency_key     text default null,
  p_metadata            jsonb default '{}'::jsonb
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
  v_txn    public.transactions%rowtype;
begin
  if p_idempotency_key is not null then
    select * into v_txn from public.transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_txn;
    end if;
  end if;

  select * into v_wallet from public.wallets
    where id = p_wallet_id and user_id = p_user_id;

  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.transactions (
    user_id,
    sender_wallet_id,
    receiver_wallet_id,
    type, status,
    source_amount, source_currency,
    destination_amount, destination_currency,
    fx_rate, fee_amount,
    external_reference, idempotency_key, metadata
  ) values (
    p_user_id,
    case when p_type in ('withdrawal', 'merchant_payment') then p_wallet_id else null end,
    case when p_type = 'deposit' then p_wallet_id else null end,
    p_type, 'pending',
    p_source_amount, p_source_currency,
    p_destination_amount, p_destination_currency,
    p_fx_rate, p_fee_amount,
    p_external_reference, p_idempotency_key, p_metadata
  )
  returning * into v_txn;

  return v_txn;
end;
$$;

-- ----------------------------------------------------------------------------
-- settle_pending_transaction: called from the webhook handler once an MNO or
-- merchant confirms the external leg. Locks the transaction row so duplicate
-- webhook deliveries are idempotent, then atomically applies the balance
-- change and records the double-entry ledger lines.
-- ----------------------------------------------------------------------------
create or replace function public.settle_pending_transaction(
  p_transaction_id     uuid,
  p_external_reference text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn    public.transactions%rowtype;
  v_wallet_id uuid;
  v_amount    numeric(20, 4);
  v_direction public.ledger_entry_direction;
begin
  select * into v_txn from public.transactions
    where id = p_transaction_id
    for update;

  if not found then
    raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotent: a transaction that already settled returns as-is.
  if v_txn.status = 'completed' then
    return v_txn;
  end if;

  if v_txn.status not in ('pending', 'processing') then
    raise exception 'TRANSACTION_NOT_SETTLEABLE' using errcode = 'P0004';
  end if;

  if v_txn.type = 'deposit' then
    v_wallet_id := v_txn.receiver_wallet_id;
    v_amount := v_txn.destination_amount;
    v_direction := 'credit';

    update public.wallets
      set balance = balance + v_amount,
          available_balance = available_balance + v_amount
      where id = v_wallet_id;
  else
    -- withdrawal / merchant_payment: funds were already reserved as
    -- unavailable at initiation time via reserve_wallet_funds(); settlement
    -- finalises the debit against the ledger balance.
    v_wallet_id := v_txn.sender_wallet_id;
    v_amount := v_txn.source_amount + v_txn.fee_amount;
    v_direction := 'debit';

    update public.wallets
      set balance = balance - v_amount
      where id = v_wallet_id;
  end if;

  update public.transactions
    set status = 'completed',
        completed_at = now(),
        external_reference = coalesce(p_external_reference, external_reference)
    where id = v_txn.id
    returning * into v_txn;

  insert into public.ledger_entries (transaction_id, wallet_id, direction, amount, currency_code)
  values (v_txn.id, v_wallet_id, v_direction, v_amount,
    case when v_direction = 'credit' then v_txn.destination_currency else v_txn.source_currency end);

  return v_txn;
end;
$$;

-- ----------------------------------------------------------------------------
-- fail_pending_transaction: called when the external provider reports a
-- failure. Releases any reserved funds and marks the transaction failed.
-- ----------------------------------------------------------------------------
create or replace function public.fail_pending_transaction(
  p_transaction_id uuid,
  p_reason         text default 'Provider declined the request'
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.transactions%rowtype;
begin
  select * into v_txn from public.transactions
    where id = p_transaction_id
    for update;

  if not found then
    raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_txn.status in ('completed', 'failed', 'reversed') then
    return v_txn;
  end if;

  if v_txn.type in ('withdrawal', 'merchant_payment') and v_txn.sender_wallet_id is not null then
    update public.wallets
      set available_balance = available_balance + v_txn.source_amount + v_txn.fee_amount
      where id = v_txn.sender_wallet_id;
  end if;

  update public.transactions
    set status = 'failed',
        failure_reason = p_reason
    where id = v_txn.id
    returning * into v_txn;

  return v_txn;
end;
$$;

-- ----------------------------------------------------------------------------
-- reserve_wallet_funds: soft-locks funds (available_balance) for an
-- outbound withdrawal/merchant_payment while it's pending external
-- confirmation, preventing double-spends on the same balance.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_wallet_funds(
  p_wallet_id uuid,
  p_amount    numeric
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets%rowtype;
begin
  select * into v_wallet from public.wallets where id = p_wallet_id for update;

  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_wallet.available_balance < p_amount then
    raise exception 'INSUFFICIENT_FUNDS' using errcode = 'P0001';
  end if;

  update public.wallets
    set available_balance = available_balance - p_amount
    where id = p_wallet_id
    returning * into v_wallet;

  return v_wallet;
end;
$$;
