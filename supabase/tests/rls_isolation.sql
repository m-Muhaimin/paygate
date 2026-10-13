-- PayGate — RLS behavioural harness
-- Run against a live local stack AFTER `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
-- Exits non-zero (RAISE EXCEPTION aborts the transaction) on any isolation failure.
-- Everything runs in one transaction and is rolled back, so it leaves no data behind.
--
-- It uses Supabase's auth.uid() shim (request.jwt.claim.sub) to exercise policies exactly as the
-- Data API would for an `authenticated` JWT.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- fixtures (as the migration/owner role; RLS is not FORCEd so the owner bypasses)
-- ---------------------------------------------------------------------------
insert into public.merchants (id, name, status, kyb_status) values
  ('mer_rls_a', 'RLS Tenant A', 'active', 'approved'),
  ('mer_rls_b', 'RLS Tenant B', 'active', 'approved');

insert into public.merchant_users (id, merchant_id, auth_user_id, role) values
  ('mru_rls_a', 'mer_rls_a', '00000000-0000-0000-0000-0000000000aa', 'owner'),
  ('mru_rls_b', 'mer_rls_b', '00000000-0000-0000-0000-0000000000bb', 'owner');

insert into public.payments (id, merchant_id, provider, amount, fee_amount, net_amount, reference) values
  ('pay_rls_a', 'mer_rls_a', 'bkash', 1000, 50, 950, 'RLSAAAA1'),
  ('pay_rls_b', 'mer_rls_b', 'nagad', 2000, 100, 1900, 'RLSBBBB1');

insert into public.api_keys (id, merchant_id, key_hash, prefix) values
  ('key_rls_a', 'mer_rls_a', 'hash-a', 'sk_test_'),
  ('key_rls_b', 'mer_rls_b', 'hash-b', 'sk_test_');

create or replace function public._rls_assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'RLS HARNESS FAIL: %', p_msg;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. authenticated tenant A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
set local role authenticated;

select public._rls_assert((select public.auth_merchant_id()) = 'mer_rls_a',
  'auth_merchant_id() maps A to mer_rls_a');

select public._rls_assert((select count(*) from public.payments) = 1,
  'A sees exactly its own payment');
select public._rls_assert((select count(*) from public.payments where merchant_id = 'mer_rls_b') = 0,
  'A cannot read tenant B payments');
select public._rls_assert((select count(*) from public.api_keys where merchant_id = 'mer_rls_b') = 0,
  'A cannot read tenant B api keys (cross-tenant read = 0 rows)');

-- own-tenant INSERT works
insert into public.payments (id, merchant_id, provider, amount, fee_amount, net_amount, reference)
values ('pay_rls_a2', 'mer_rls_a', 'bkash', 500, 25, 475, 'RLSAAAA2');
select public._rls_assert((select count(*) from public.payments where id = 'pay_rls_a2') = 1,
  'own-tenant insert succeeds');

-- cross-tenant INSERT is blocked
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.payments (id, merchant_id, provider, amount, fee_amount, net_amount, reference)
    values ('pay_rls_a3', 'mer_rls_b', 'bkash', 500, 25, 475, 'RLSBBBB2');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'RLS HARNESS FAIL: cross-tenant insert was allowed';
  end if;
end $$;

-- cross-tenant UPDATE affects 0 rows
with upd as (
  update public.payments set amount = 1, fee_amount = 0, net_amount = 1
  where merchant_id = 'mer_rls_b' returning 1
)
select public._rls_assert((select count(*) from upd) = 0,
  'A cannot update tenant B payments');

-- cross-tenant DELETE affects 0 rows
with del as (
  delete from public.pricing_plans where merchant_id = 'mer_rls_b' returning 1
)
select public._rls_assert((select count(*) from del) = 0,
  'A cannot delete tenant B plans');

-- ---------------------------------------------------------------------------
-- 2. anon: no table grants and no policies
-- ---------------------------------------------------------------------------
reset role;
select public._rls_assert(not has_table_privilege('anon', 'public.payments', 'select'),
  'anon has no SELECT grant on payments');
select public._rls_assert(not has_table_privilege('anon', 'public.payments', 'insert'),
  'anon has no INSERT grant on payments');
select public._rls_assert(not has_table_privilege('anon', 'public.merchants', 'select'),
  'anon has no SELECT grant on merchants');

-- device/ingest/admin tables are not reachable by authenticated either
select public._rls_assert(not has_table_privilege('authenticated', 'public.wallets', 'select'),
  'authenticated cannot reach wallets');
select public._rls_assert(not has_table_privilege('authenticated', 'public.devices', 'select'),
  'authenticated cannot reach devices');
select public._rls_assert(not has_table_privilege('authenticated', 'public.incoming_txns', 'select'),
  'authenticated cannot read incoming_txns (insert-only ingest)');

-- SECURITY DEFINER money helpers are service_role-only
select public._rls_assert(not has_function_privilege('authenticated', 'public.assign_wallet(text,text)', 'execute'),
  'authenticated cannot execute assign_wallet');
select public._rls_assert(not has_function_privilege('authenticated', 'public.claim_incoming_txn(text,text,text,text)', 'execute'),
  'authenticated cannot execute claim_incoming_txn');
select public._rls_assert(not has_function_privilege('authenticated', 'public.merchant_balance(text)', 'execute'),
  'authenticated cannot execute merchant_balance');

-- ---------------------------------------------------------------------------
-- 3. service_role bypasses RLS
-- ---------------------------------------------------------------------------
set local role service_role;
select public._rls_assert((select count(*) from public.payments) = 3,
  'service_role sees all rows across tenants');

reset role;
rollback;
