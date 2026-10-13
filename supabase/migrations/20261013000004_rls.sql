-- PayGate platform — migration 0004: Row Level Security
-- SPEC §6/§9: RLS enabled on every table; merchant-scoped tables are keyed on merchant_id via
-- auth_merchant_id(), which maps the Supabase Auth user (auth.uid()) to a merchant through
-- merchant_users. service_role has BYPASSRLS and therefore bypasses these policies naturally
-- (the server/api path). anon is granted nothing here: the public pay page and device webhooks
-- are served server-side through service_role.
--
-- Data API exposure (changelog 2026-04-28, enforced 2026-10-30): new public tables are NOT
-- auto-exposed, so access is granted explicitly below.

-- ---------------------------------------------------------------------------
-- Helper: resolve the calling Supabase Auth user -> merchant_id
-- SECURITY DEFINER is required so the lookup on merchant_users does not re-enter the
-- merchant_users RLS policy (which itself calls this helper) — the classic "infinite recursion
-- detected in policy for relation" (42P17) trap. It only ever returns the caller's OWN merchant
-- (filtered by auth.uid()) and NULL for anonymous callers, so leaving EXECUTE available to
-- authenticated is safe and necessary (policies evaluate as the invoking user).
-- ---------------------------------------------------------------------------
create or replace function public.auth_merchant_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select merchant_id
  from public.merchant_users
  where auth_user_id = auth.uid()
  order by created_at
  limit 1;
$$;

grant execute on function public.auth_merchant_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (deny-by-default once enabled).
-- ---------------------------------------------------------------------------
alter table public.merchants            enable row level security;
alter table public.pricing_plans        enable row level security;
alter table public.devices              enable row level security;
alter table public.wallets              enable row level security;
alter table public.payments             enable row level security;
alter table public.incoming_txns        enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.settlements          enable row level security;
alter table public.payouts              enable row level security;
alter table public.webhook_deliveries   enable row level security;
alter table public.audit_log            enable row level security;
alter table public.merchant_users       enable row level security;
alter table public.api_keys             enable row level security;
alter table public.device_pairing_codes enable row level security;

-- ---------------------------------------------------------------------------
-- Platform-scoped / ingestion / audit tables: RLS enabled, NO policies.
--   * wallets, devices  -> admin-managed fleet (SPEC §7 /v1/admin/*), service_role only.
--   * audit_log         -> append-only, written by trusted server/admin code.
--   * incoming_txns     -> INSERT-ONLY ingest from the device SMS webhook (SPEC §7
--                          /v1/sms/webhook) via service_role. No anon/authenticated access:
--                          devices authenticate with a hashed device token at the app layer, then
--                          the server writes here with service_role. service_role also UPDATEs
--                          claimed_payment_id through claim_incoming_txn(). No SELECT/UPDATE/
--                          DELETE policy is exposed to end users.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- merchant-scoped policies (SPEC §6). Every UPDATE policy carries both USING and WITH CHECK so a
-- row's merchant_id cannot be reassigned across tenants.
-- ---------------------------------------------------------------------------

-- merchants (scoped by primary key `id`)
create policy rl_merchants_select on public.merchants
  for select to authenticated
  using (id = (select public.auth_merchant_id()));
create policy rl_merchants_update on public.merchants
  for update to authenticated
  using (id = (select public.auth_merchant_id()))
  with check (id = (select public.auth_merchant_id()));

-- pricing_plans
create policy rl_pricing_plans_select on public.pricing_plans
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));
create policy rl_pricing_plans_insert on public.pricing_plans
  for insert to authenticated
  with check (merchant_id = (select public.auth_merchant_id()));
create policy rl_pricing_plans_update on public.pricing_plans
  for update to authenticated
  using (merchant_id = (select public.auth_merchant_id()))
  with check (merchant_id = (select public.auth_merchant_id()));
create policy rl_pricing_plans_delete on public.pricing_plans
  for delete to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- payments (merchant reads; creation is normally server-side via service_role)
create policy rl_payments_select on public.payments
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));
create policy rl_payments_insert on public.payments
  for insert to authenticated
  with check (merchant_id = (select public.auth_merchant_id()));
create policy rl_payments_update on public.payments
  for update to authenticated
  using (merchant_id = (select public.auth_merchant_id()))
  with check (merchant_id = (select public.auth_merchant_id()));

-- ledger_entries (system-computed ledger: read-only to merchants)
create policy rl_ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- settlements (system-generated: read-only to merchants)
create policy rl_settlements_select on public.settlements
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- payouts (merchant requests; approval is admin/service_role)
create policy rl_payouts_select on public.payouts
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));
create policy rl_payouts_insert on public.payouts
  for insert to authenticated
  with check (merchant_id = (select public.auth_merchant_id()));

-- webhook_deliveries (system-generated: read-only to merchants)
create policy rl_webhook_deliveries_select on public.webhook_deliveries
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- merchant_users (a member can see the members of their own merchant)
create policy rl_merchant_users_select on public.merchant_users
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- api_keys (hashes managed server-side; owner may read their own rows)
create policy rl_api_keys_select on public.api_keys
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));

-- device_pairing_codes (merchant initiates pairing)
create policy rl_device_pairing_codes_select on public.device_pairing_codes
  for select to authenticated
  using (merchant_id = (select public.auth_merchant_id()));
create policy rl_device_pairing_codes_insert on public.device_pairing_codes
  for insert to authenticated
  with check (merchant_id = (select public.auth_merchant_id()));

-- ---------------------------------------------------------------------------
-- Explicit Data API grants (tables are not auto-exposed — see changelog 2026-04-28).
-- service_role gets full access (RLS bypassed); authenticated gets only the privileges the
-- policies above can allow. anon gets none.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Start from a clean slate for the Data API roles (guards against any project-level default
-- privileges auto-granting on new tables), then grant exactly what is intended.
revoke all privileges on all tables in schema public from anon, authenticated;

grant all privileges on all tables in schema public to service_role;

grant select on
  public.merchants,
  public.pricing_plans,
  public.payments,
  public.ledger_entries,
  public.settlements,
  public.payouts,
  public.webhook_deliveries,
  public.merchant_users,
  public.api_keys,
  public.device_pairing_codes
  to authenticated;

grant insert, update, delete on public.pricing_plans to authenticated;
grant insert, update on public.payments to authenticated;
grant insert on public.payouts to authenticated;
grant insert on public.device_pairing_codes to authenticated;
grant update on public.merchants to authenticated;
