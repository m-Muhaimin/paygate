-- PayGate platform — migration 0005: v3.1 Enhanced Checkout / Confirm-Flow delta
-- Normative contract: SPEC_v3_1_addendum.md §A (payments state machine), §C (auto-confirm).
-- Adds the confirm-flow columns + `merchants.auto_confirm`, extends the payment status domain
-- with 'confirming', and adds the supporting lookup indexes.
-- Idempotent at the object level (ADD COLUMN IF NOT EXISTS / guarded DO block / CREATE INDEX
-- IF NOT EXISTS) so it can be re-applied without error, though `supabase db reset` normally
-- runs it once on a clean DB.

-- ---------------------------------------------------------------------------
-- payments.status: extend the state domain with 'confirming'
--   created -> awaiting_payment -> confirming -> paid; terminal: expired, cancelled, needs_review
--
-- This schema models the status as the `payment_status` ENUM type (migration 0001), so the
-- extension is an enum-value add — NOT a CHECK-constraint drop/recreate (there is no CHECK on
-- payments.status; the only named constraint on payments is `payments_net_check`). The guarded
-- block below handles the enum case and, defensively, drops+recreates a status CHECK if a future
-- schema version ever swaps the enum for text+CHECK. `ADD VALUE IF NOT EXISTS` is idempotent and
-- valid inside the migration transaction on PostgreSQL 12+ (Supabase runs 15+).
-- ---------------------------------------------------------------------------
do $$
declare
  v_status_type text;
  v_conname     text;
begin
  select t.typname
    into v_status_type
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t      on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'payments'
    and a.attname = 'status'
    and a.attnum > 0
    and not a.attisdropped;

  if v_status_type = 'payment_status' then
    execute 'alter type public.payment_status add value if not exists ''confirming'' after ''awaiting_payment''';
  else
    -- Defensive fallback (no-op in the current schema): recreate any CHECK that constrains
    -- payments.status so the new value set includes 'confirming'.
    for v_conname in
      select con.conname
      from pg_constraint con
      join pg_class rel    on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public'
        and rel.relname = 'payments'
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%status%'
    loop
      execute format('alter table public.payments drop constraint %I', v_conname);
      execute format(
        'alter table public.payments add constraint %I check (status in '
        '(''created'',''awaiting_payment'',''confirming'',''paid'',''expired'',''cancelled'',''needs_review''))',
        v_conname);
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- payments: confirm-flow columns (SPEC v3.1 §A, §B)
--   success_url / cancel_url  -> redirect targets for redirect-mode checkout
--   confirm_attempts          -> server-side lockout counter (locked at >= 5)
--   confirmed_at              -> when the customer accepted the confirm
--   locked_until              -> confirms rejected while now() < locked_until (429)
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists success_url      text,
  add column if not exists cancel_url       text,
  add column if not exists confirm_attempts integer not null default 0,
  add column if not exists confirmed_at     timestamptz,
  add column if not exists locked_until     timestamptz;

-- ---------------------------------------------------------------------------
-- merchants: optional per-merchant auto-confirm (SPEC v3.1 §C)
-- ---------------------------------------------------------------------------
alter table public.merchants
  add column if not exists auto_confirm boolean not null default false;

-- ---------------------------------------------------------------------------
-- Indexes (SPEC v3.1 §A/B): status lookups for the confirm flow + lockout scans.
-- A standalone payments(status) index does not exist yet — the composite
-- `payments_merchant_status_created_idx` leads with merchant_id and cannot serve a
-- status-only predicate. `payments(locked_until)` backs the "locked_until > now()" check.
-- ---------------------------------------------------------------------------
create index if not exists payments_status_idx
  on public.payments (status);

create index if not exists payments_locked_until_idx
  on public.payments (locked_until);
