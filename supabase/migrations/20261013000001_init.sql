-- PayGate platform — migration 0001: extensions, enums, tables
-- Normative contract: SPEC_v3.md §1 (money/time), §3 (payment states), §6 (schema).
-- Money = integer paisa. Time = timestamptz. IDs = text with prefixed defaults.
-- Idempotent at the object level (CREATE ... IF NOT EXISTS / guarded DO blocks) so it can be
-- re-applied without error, though `supabase db reset` normally runs it once on a clean DB.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;  -- gen_random_uuid(), gen_random_bytes()

-- ---------------------------------------------------------------------------
-- Enums (SPEC §3, §5, §6, §9)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'provider') then
    create type provider as enum ('bkash', 'nagad', 'rocket');
  end if;
  if not exists (select 1 from pg_type where typname = 'merchant_status') then
    create type merchant_status as enum ('pending', 'active', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'kyb_status') then
    create type kyb_status as enum ('pending', 'under_review', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'risk_tier') then
    create type risk_tier as enum ('low', 'medium', 'high');
  end if;
  if not exists (select 1 from pg_type where typname = 'plan_status') then
    create type plan_status as enum ('active', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'wallet_status') then
    create type wallet_status as enum ('active', 'draining', 'disabled');
  end if;
  if not exists (select 1 from pg_type where typname = 'device_status') then
    create type device_status as enum ('active', 'revoked');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    -- SPEC §3: created -> awaiting_payment -> paid; terminal: expired, cancelled, needs_review
    create type payment_status as enum
      ('created', 'awaiting_payment', 'paid', 'expired', 'cancelled', 'needs_review');
  end if;
  if not exists (select 1 from pg_type where typname = 'review_reason') then
    create type review_reason as enum
      ('underpaid', 'overpaid', 'wrong_wallet', 'late_payment', 'duplicate_ref', 'conflict', 'unmatched');
  end if;
  if not exists (select 1 from pg_type where typname = 'matched_by') then
    create type matched_by as enum ('reference', 'trxid');
  end if;
  if not exists (select 1 from pg_type where typname = 'ledger_account') then
    -- SPEC §6: double-entry accounts
    create type ledger_account as enum ('payin', 'fee', 'merchant_payable', 'payout', 'refund');
  end if;
  if not exists (select 1 from pg_type where typname = 'ledger_direction') then
    create type ledger_direction as enum ('debit', 'credit');
  end if;
  if not exists (select 1 from pg_type where typname = 'settlement_status') then
    create type settlement_status as enum ('pending', 'processing', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'payout_rail') then
    create type payout_rail as enum ('bank', 'mfs');
  end if;
  if not exists (select 1 from pg_type where typname = 'payout_status') then
    create type payout_status as enum ('requested', 'approved', 'rejected', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'webhook_status') then
    create type webhook_status as enum ('pending', 'success', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'merchant_role') then
    -- SPEC §9 Supabase Auth roles
    create type merchant_role as enum ('owner', 'staff', 'developer', 'viewer');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- merchants  (root tenant entity)
-- ---------------------------------------------------------------------------
create table if not exists merchants (
  id                    text primary key
                          default 'mer_' || encode(gen_random_bytes(9), 'hex'),
  name                  text not null,
  status                merchant_status not null default 'pending',
  kyb_status            kyb_status not null default 'pending',
  payout_account        jsonb,  -- {type: bank|mfs, provider, account_no, holder, bank_name}
  fee_rate_bps          integer not null default 500
                          check (fee_rate_bps between 0 and 10000),
  risk_tier             risk_tier not null default 'low',
  webhook_secret_hash   text,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pricing_plans  (SPEC §6, §7)
-- ---------------------------------------------------------------------------
create table if not exists pricing_plans (
  id             text primary key
                   default 'plan_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id    text not null references merchants (id) on delete cascade,
  name           text not null,
  amount         integer check (amount is null or amount >= 0),  -- paisa; null when open_amount
  currency       text not null default 'BDT',
  external_sku   text,
  version        integer not null default 1,
  status         plan_status not null default 'active',
  open_amount    boolean not null default false,
  min_amount     integer check (min_amount is null or min_amount >= 0),
  max_amount     integer check (max_amount is null or max_amount >= 0),
  created_at     timestamptz not null default now(),
  -- fixed-amount plans must carry an amount; open-amount plans must carry a range
  -- (named *_consistency_* to avoid clashing with the auto-generated column check
  --  `pricing_plans_amount_check` on the `amount` column)
  constraint pricing_plans_amount_consistency_check check (
    (open_amount = false and amount is not null)
    or (open_amount = true and amount is null and min_amount is not null and max_amount is not null)
  )
);

-- ---------------------------------------------------------------------------
-- devices  (SPEC §6; platform-scoped fleet, managed by admins — no merchant_id)
-- ---------------------------------------------------------------------------
create table if not exists devices (
  id                 text primary key
                       default 'dev_' || encode(gen_random_bytes(9), 'hex'),
  name               text,
  model              text,
  app_version        text,
  token_hash         text,  -- hashed 256-bit device token (nullable until pairing completes)
  status             device_status not null default 'active',
  last_heartbeat_at  timestamptz,
  battery            integer check (battery is null or battery between 0 and 100),
  queue_depth        integer not null default 0,
  permissions        jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- wallets  (SPEC §5, §6; platform-scoped pool, assigned across merchants)
-- ---------------------------------------------------------------------------
create table if not exists wallets (
  id                text primary key
                      default 'wal_' || encode(gen_random_bytes(9), 'hex'),
  provider          provider not null,
  msisdn            text not null,
  holder_name       text,
  device_id         text references devices (id) on delete set null,
  sim_slot          integer,
  status            wallet_status not null default 'active',
  daily_limit       integer not null default 0 check (daily_limit >= 0),      -- paisa
  monthly_limit     integer check (monthly_limit is null or monthly_limit >= 0),
  today_total       integer not null default 0 check (today_total >= 0),      -- paisa
  concurrency_cap   integer not null default 20 check (concurrency_cap > 0),  -- max pending payments
  last_assigned_at  timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- payments  (SPEC §3, §4, §6)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id                   text primary key
                         default 'pay_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id          text not null references merchants (id) on delete restrict,
  plan_id              text references pricing_plans (id) on delete set null,
  plan_snapshot        jsonb,
  order_id             text,
  provider             provider not null,
  wallet_id            text references wallets (id) on delete set null,
  offered_wallet_ids   text[],
  amount               integer not null check (amount >= 0),          -- paisa
  fee_amount           integer not null default 0 check (fee_amount >= 0),
  net_amount           integer not null default 0 check (net_amount >= 0),
  reference            text not null,  -- 8-char, unique index in migration 0002 (SPEC §2)
  status               payment_status not null default 'created',
  review_reason        review_reason,
  matched_by           matched_by,
  submitted_trx_id     text,
  idempotency_key      text,
  callback_url         text,
  metadata             jsonb,
  expires_at           timestamptz,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  constraint payments_net_check check (net_amount = amount - fee_amount)
);

-- ---------------------------------------------------------------------------
-- incoming_txns  (SPEC §4, §6; ingested by device SMS webhook via service role)
-- Natural key = (provider, trx_id, wallet_id): the same provider trx can only be received once
-- by a given wallet. `raw` is app-level encrypted (SPEC §9 privacy).
-- ---------------------------------------------------------------------------
create table if not exists incoming_txns (
  provider            provider not null,
  trx_id              text not null,
  wallet_id           text not null references wallets (id) on delete restrict,
  amount              integer not null check (amount >= 0),   -- paisa
  balance_after       integer,
  ref_raw             text,
  ref_normalized      text,
  raw                 text,                                  -- encrypted at rest (app-level)
  client_msg_id       text,
  sim_slot            integer,
  claimed_payment_id  text references payments (id) on delete set null,
  flags               text[],
  received_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (provider, trx_id, wallet_id)
);

-- ---------------------------------------------------------------------------
-- ledger_entries  (SPEC §6; double-entry, balances always recomputed)
-- ---------------------------------------------------------------------------
create table if not exists ledger_entries (
  id            text primary key
                  default 'led_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id   text not null references merchants (id) on delete restrict,
  payment_id    text references payments (id) on delete set null,
  account       ledger_account not null,
  direction     ledger_direction not null,
  amount        integer not null check (amount > 0),  -- paisa, sign carried by `direction`
  entry_group   text not null,                        -- groups the two legs of one journal entry
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- settlements  (SPEC §6)
-- ---------------------------------------------------------------------------
create table if not exists settlements (
  id            text primary key
                  default 'set_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id   text not null references merchants (id) on delete restrict,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  gross_amount  integer not null default 0 check (gross_amount >= 0),
  fee_amount    integer not null default 0 check (fee_amount >= 0),
  net_amount    integer not null default 0 check (net_amount >= 0),
  status        settlement_status not null default 'pending',
  created_at    timestamptz not null default now(),
  constraint settlements_period_check check (period_end >= period_start)
);

-- ---------------------------------------------------------------------------
-- payouts  (SPEC §0, §6)
-- ---------------------------------------------------------------------------
create table if not exists payouts (
  id            text primary key
                  default 'po_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id   text not null references merchants (id) on delete restrict,
  amount        integer not null check (amount > 0),  -- paisa; min Tk 1,000 enforced in app
  rail          payout_rail not null,
  destination   jsonb,  -- {account_no, holder, bank_name, provider}
  status        payout_status not null default 'requested',
  requested_by  text,
  approved_by   text,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- webhook_deliveries  (SPEC §6, §8)
-- ---------------------------------------------------------------------------
create table if not exists webhook_deliveries (
  id                text primary key
                      default 'whd_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id       text not null references merchants (id) on delete cascade,
  payment_id        text references payments (id) on delete set null,
  event_type        text not null,
  event_id          text not null default 'evt_' || encode(gen_random_bytes(9), 'hex'),
  url               text not null,
  payload           jsonb,
  status            webhook_status not null default 'pending',
  attempts          integer not null default 0 check (attempts >= 0),
  next_attempt_at   timestamptz,
  last_status_code  integer,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log  (SPEC §6; append-only, service/admin-written)
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  id           text primary key
                 default 'aud_' || encode(gen_random_bytes(9), 'hex'),
  actor        text,
  action       text not null,
  entity_type  text,
  entity_id    text,
  "before"     jsonb,
  "after"      jsonb,
  ip           text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- merchant_users  (SPEC §6, §9; maps Supabase Auth users -> merchants)
-- NOTE: auth_user_id is intentionally NOT FK-constrained to auth.users so this table can be
-- seeded without creating Auth users; resolve/validate against auth.users in the app.
-- ---------------------------------------------------------------------------
create table if not exists merchant_users (
  id            text primary key
                  default 'mru_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id   text not null references merchants (id) on delete cascade,
  auth_user_id  uuid not null,
  role          merchant_role not null default 'viewer',
  email         text,
  created_at    timestamptz not null default now(),
  constraint merchant_users_unique unique (merchant_id, auth_user_id)
);

-- ---------------------------------------------------------------------------
-- api_keys  (SPEC §6, §9; hashed at rest)
-- ---------------------------------------------------------------------------
create table if not exists api_keys (
  id            text primary key
                  default 'key_' || encode(gen_random_bytes(9), 'hex'),
  merchant_id   text not null references merchants (id) on delete cascade,
  key_hash      text not null,
  prefix        text not null
                  check (prefix like 'sk_live_%' or prefix like 'sk_test_%'),
  label         text,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  last_used_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- device_pairing_codes  (SPEC §6, §7)
-- ---------------------------------------------------------------------------
create table if not exists device_pairing_codes (
  code         text primary key,
  merchant_id  text not null references merchants (id) on delete cascade,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
