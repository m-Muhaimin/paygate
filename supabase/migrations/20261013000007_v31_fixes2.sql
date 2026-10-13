-- PayGate platform — migration 0007: v3.1 fixes (approve_payout double-reservation fix)
-- Fix: only status 'requested' counts as reserved/pending; approved payouts already debited

-- ---------------------------------------------------------------------------
-- RPC: public.approve_payout(p_payout_id text, p_actor text) returns setof payouts
--    SECURITY DEFINER, set search_path = public, atomic in single transaction
-- ---------------------------------------------------------------------------
create or replace function public.approve_payout(
  p_payout_id text,
  p_actor text
)
returns setof public.payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts;
  v_merchant_id text;
  v_amount integer;
  v_requested_by text;
  v_status public.payout_status;
  v_balance bigint;
  v_reserved bigint;
begin
  -- Lock payout row for update
  select *
    into v_payout
  from public.payouts
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'PAYOUT_NOT_FOUND: payout % not found', p_payout_id;
  end if;

  v_merchant_id := v_payout.merchant_id;
  v_amount := v_payout.amount;
  v_requested_by := v_payout.requested_by;
  v_status := v_payout.status;

  -- Lock merchant row to serialize money ops per merchant
  perform 1
  from public.merchants
  where id = v_merchant_id
  for update;

  -- Check status
  if v_status <> 'requested' then
    raise exception 'PAYOUT_NOT_REQUESTED: payout % is not in requested status (current: %)', p_payout_id, v_status;
  end if;

  -- Two-person rule: approver != requester
  if v_requested_by is not null and v_requested_by = p_actor then
    raise exception 'PAYOUT_SELF_APPROVAL: approver % cannot approve their own payout %', p_actor, p_payout_id;
  end if;

  -- Balance re-check inside same transaction
  v_balance := public.merchant_balance(v_merchant_id);
  select coalesce(sum(amount), 0)
    into v_reserved
  from public.payouts
  where merchant_id = v_merchant_id
    and status = 'requested'
    and id <> p_payout_id;

  if (v_balance - v_reserved) < v_amount then
    raise exception 'PAYOUT_INSUFFICIENT_BALANCE: insufficient balance for payout % (balance=% reserved=% amount=%)', p_payout_id, v_balance, v_reserved, v_amount;
  end if;

  -- Insert payout debit ledger entry (payment_id NULL, account='payout', direction='debit')
  insert into public.ledger_entries (
    id,
    merchant_id,
    payment_id,
    account,
    direction,
    amount,
    entry_group
  ) values (
    'led_' || encode(gen_random_bytes(9), 'hex'),
    v_merchant_id,
    null,
    'payout',
    'debit',
    v_amount,
    p_payout_id
  );

  -- Update payout to approved
  update public.payouts
     set status = 'approved',
         approved_by = p_actor,
         approved_at = now()
   where id = p_payout_id
  returning * into v_payout;

  return next v_payout;
end;
$$;

-- Idempotent-skip guard: ensure function exists and is callable; re-creating is idempotent via CREATE OR REPLACE
do $$
begin
  -- no-op guard to make re-apply safe
  perform 1 from pg_proc where proname = 'approve_payout' and pronamespace = 'public'::regnamespace;
end
$$;

-- Lock down EXECUTE on SECURITY DEFINER function
revoke all on function public.approve_payout(text, text) from public, anon, authenticated;
grant execute on function public.approve_payout(text, text) to service_role;
