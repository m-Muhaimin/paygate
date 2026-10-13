-- PayGate platform — migration 0003: atomic DB helper functions
-- SPEC §5 (wallet assignment), §4 (atomic incoming-txn claim), §6 (ledger balance).
--
-- These are SECURITY DEFINER because they must operate across RLS-protected tables (wallets,
-- payments, incoming_txns, ledger_entries). Per the Supabase security checklist, SECURITY DEFINER
-- functions in the exposed `public` schema are callable by every role by default, so EXECUTE is
-- revoked from PUBLIC/anon/authenticated and granted only to service_role (the trusted server
-- path). If an authenticated (merchant dashboard) caller ever needs one of these, add it
-- explicitly with an auth_merchant_id() ownership check at the top of the function.
-- search_path is pinned to public on every function (no schema-mutation/privilege-escalation).

-- ---------------------------------------------------------------------------
-- assign_wallet(provider, merchant_id) -> wallets row or NULL
-- Picks the least-recently-assigned active wallet for a provider whose device phone is healthy
-- (heartbeat < 3 min), that still has daily headroom, and that has fewer pending payments than
-- its concurrency_cap. Atomically stamps last_assigned_at. Returns NULL when none qualifies
-- (caller maps that to 503 no_wallet_available, SPEC §5).
--
-- NOTE: p_merchant_id is accepted for API/signature stability but wallets are a platform-wide
-- pool in SPEC §6 (no merchant_id column); it is reserved for future per-merchant scoping.
-- ---------------------------------------------------------------------------
create or replace function public.assign_wallet(
  p_provider text,
  p_merchant_id text
)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallets;
begin
  select w.*
    into v_wallet
  from public.wallets w
  join public.devices d on d.id = w.device_id
  where w.provider::text = lower(p_provider)
    and w.status = 'active'
    and d.status = 'active'
    and d.last_heartbeat_at is not null
    and d.last_heartbeat_at > now() - interval '3 minutes'
    and w.today_total < w.daily_limit
    and (
          select count(*)
          from public.payments p
          where p.wallet_id = w.id
            and p.status in ('created', 'awaiting_payment')
        ) < w.concurrency_cap
  order by w.last_assigned_at asc nulls first
  limit 1
  for update of w skip locked;

  if not found then
    return null;
  end if;

  update public.wallets
     set last_assigned_at = now()
   where id = v_wallet.id
  returning * into v_wallet;

  return v_wallet;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_incoming_txn(provider, trx_id, wallet_id, payment_id) -> boolean
-- Atomic single-use claim of an incoming transaction. Returns true only when this call won the
-- race (i.e. exactly the row with a NULL claimed_payment_id was updated); false otherwise
-- (already claimed / not found). SPEC §4 "each runs in ONE DB transaction on an unclaimed txn".
-- ---------------------------------------------------------------------------
create or replace function public.claim_incoming_txn(
  p_provider text,
  p_trx_id text,
  p_wallet_id text,
  p_payment_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  update public.incoming_txns
     set claimed_payment_id = p_payment_id
   where provider::text = lower(p_provider)
     and trx_id = p_trx_id
     and wallet_id = p_wallet_id
     and claimed_payment_id is null
  returning true into v_found;

  return coalesce(v_found, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- merchant_balance(merchant_id) -> bigint (paisa)
-- Available balance computed from the ledger only (no cached column). Credits to
-- `merchant_payable` increase it; debits to `merchant_payable`, `payout` and `refund` reduce it.
-- ---------------------------------------------------------------------------
create or replace function public.merchant_balance(p_merchant_id text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when account = 'merchant_payable' and direction = 'credit' then amount
      when account = 'merchant_payable' and direction = 'debit'  then -amount
      when account in ('payout', 'refund') and direction = 'debit'  then -amount
      when account in ('payout', 'refund') and direction = 'credit' then amount
      else 0
    end
  ), 0)::bigint
  from public.ledger_entries
  where merchant_id = p_merchant_id;
$$;

-- ---------------------------------------------------------------------------
-- Lock down EXECUTE on the SECURITY DEFINER helpers (Supabase security checklist).
-- ---------------------------------------------------------------------------
revoke all on function public.assign_wallet(text, text) from public, anon, authenticated;
revoke all on function public.claim_incoming_txn(text, text, text, text) from public, anon, authenticated;
revoke all on function public.merchant_balance(text) from public, anon, authenticated;

grant execute on function public.assign_wallet(text, text) to service_role;
grant execute on function public.claim_incoming_txn(text, text, text, text) to service_role;
grant execute on function public.merchant_balance(text) to service_role;
