# PayGate — Database Schema Reference

Normative source: [`SPEC_v3.md`](../SPEC_v3.md) §6 (schema), §5 (wallet assignment), §3/§4 (states/matching).
All **money = integer paisa** (BDT × 100). All **time = `timestamptz`**. All **IDs = `text`** with prefixed defaults. Providers: `bkash`, `nagad`, `rocket`.

## Migration run order

| # | File | Contents |
|---|------|----------|
| 1 | `supabase/migrations/20261013000001_init.sql` | `pgcrypto`, all enums, all 14 tables |
| 2 | `supabase/migrations/20261013000002_indexes.sql` | unique + supporting indexes |
| 3 | `supabase/migrations/20261013000003_functions.sql` | `assign_wallet`, `claim_incoming_txn`, `merchant_balance` |
| 4 | `supabase/migrations/20261013000004_rls.sql` | `auth_merchant_id()`, RLS enable + policies, Data API grants |
| 5 | `supabase/migrations/20261013000005_v31.sql` | **v3.1** confirm-flow columns, `confirming` state, supporting indexes |
| — | `supabase/seed.sql` | idempotent demo data (`db reset` runs it automatically) |

Apply: `npx supabase start` then `npx supabase db reset` (local), or `npx supabase db push` (linked).
`config.toml`: `project_id = "paygate"`, hosted region `ap-southeast-1` (Singapore).

## Enums

`provider` = bkash, nagad, rocket · `merchant_status` = pending, active, suspended · `kyb_status` = pending, under_review, approved, rejected · `risk_tier` = low, medium, high · `plan_status` = active, archived · `wallet_status` = active, draining, disabled · `device_status` = active, revoked · `payment_status` = created, awaiting_payment, **confirming** (v3.1), paid, expired, cancelled, needs_review · `review_reason` = underpaid, overpaid, wrong_wallet, late_payment, duplicate_ref, conflict, unmatched · `matched_by` = reference, trxid · `ledger_account` = payin, fee, merchant_payable, payout, refund · `ledger_direction` = debit, credit · `settlement_status` = pending, processing, paid · `payout_rail` = bank, mfs · `payout_status` = requested, approved, rejected, paid · `webhook_status` = pending, success, failed · `merchant_role` = owner, staff, developer, viewer.

## Tables

`created_at timestamptz not null default now()` on every table unless noted.

### merchants — tenant root
| column | type | notes |
|---|---|---|
| id | text PK | `mer_…` |
| name | text NOT NULL | |
| status | merchant_status NOT NULL | default `pending` |
| kyb_status | kyb_status NOT NULL | default `pending` |
| payout_account | jsonb | `{type, provider, account_no, holder, bank_name}` |
| fee_rate_bps | integer NOT NULL | default `500` (5%), check 0–10000 |
| risk_tier | risk_tier NOT NULL | default `low` |
| auto_confirm | boolean NOT NULL | default `false` — **v3.1**: engine confirms matching SMS without customer action (SPEC v3.1 §C) |
| webhook_secret_hash | text | hashed HMAC secret |
| created_at | timestamptz NOT NULL | |

### pricing_plans
| column | type | notes |
|---|---|---|
| id | text PK | `plan_…` |
| merchant_id | text NOT NULL FK→merchants(id) ON DELETE CASCADE | |
| name | text NOT NULL | |
| amount | integer | paisa; NULL when `open_amount` |
| currency | text NOT NULL | default `BDT` |
| external_sku | text | |
| version | integer NOT NULL | default `1` |
| status | plan_status NOT NULL | default `active` |
| open_amount | boolean NOT NULL | default `false` |
| min_amount / max_amount | integer | required for open-amount plans |
| created_at | timestamptz NOT NULL | |

Constraint: fixed plans need `amount`; open plans need `amount IS NULL` + `min_amount` + `max_amount`.

### devices — platform-scoped fleet (no merchant_id)
| column | type | notes |
|---|---|---|
| id | text PK | `dev_…` |
| name / model / app_version | text | |
| token_hash | text | hashed 256-bit device token (nullable until paired) |
| status | device_status NOT NULL | default `active` |
| last_heartbeat_at | timestamptz | drives wallet health (< 3 min) |
| battery | integer | 0–100 |
| queue_depth | integer NOT NULL | default `0` |
| permissions | jsonb NOT NULL | default `{}` |
| created_at | timestamptz NOT NULL | |

### wallets — platform-scoped pool
| column | type | notes |
|---|---|---|
| id | text PK | `wal_…` |
| provider | provider NOT NULL | |
| msisdn | text NOT NULL | receiving phone number |
| holder_name | text | |
| device_id | text FK→devices(id) ON DELETE SET NULL | |
| sim_slot | integer | |
| status | wallet_status NOT NULL | default `active` |
| daily_limit | integer NOT NULL | default `0`, paisa |
| monthly_limit | integer | paisa |
| today_total | integer NOT NULL | default `0`, paisa |
| concurrency_cap | integer NOT NULL | default `20`, max pending payments |
| last_assigned_at | timestamptz | assignment tie-break |
| created_at | timestamptz NOT NULL | |

### payments
| column | type | notes |
|---|---|---|
| id | text PK | `pay_…` |
| merchant_id | text NOT NULL FK→merchants(id) ON DELETE RESTRICT | |
| plan_id | text FK→pricing_plans(id) ON DELETE SET NULL | |
| plan_snapshot | jsonb | |
| order_id | text | |
| provider | provider NOT NULL | |
| wallet_id | text FK→wallets(id) ON DELETE SET NULL | |
| offered_wallet_ids | text[] | |
| amount | integer NOT NULL | paisa |
| fee_amount | integer NOT NULL | default `0` |
| net_amount | integer NOT NULL | default `0`; check `net = amount - fee` |
| reference | text NOT NULL | 8 chars; UNIQUE index |
| status | payment_status NOT NULL | default `created` |
| review_reason | review_reason | |
| matched_by | matched_by | |
| submitted_trx_id | text | |
| idempotency_key | text | UNIQUE per merchant (partial) |
| callback_url | text | |
| success_url | text | **v3.1** — redirect target on resolution |
| cancel_url | text | **v3.1** — redirect target on cancel/expiry |
| confirm_attempts | integer NOT NULL | **v3.1** default `0`; server-side lockout counter (locked at ≥ 5) |
| confirmed_at | timestamptz | **v3.1** — when the customer pressed Confirm |
| locked_until | timestamptz | **v3.1** — confirms rejected while `now() < locked_until` (429) |
| metadata | jsonb | |
| expires_at / paid_at | timestamptz | |
| created_at | timestamptz NOT NULL | |

### incoming_txns — device SMS ingest (composite PK)
| column | type | notes |
|---|---|---|
| provider | provider NOT NULL | PK part |
| trx_id | text NOT NULL | PK part |
| wallet_id | text NOT NULL FK→wallets(id) ON DELETE RESTRICT | PK part |
| amount | integer NOT NULL | paisa |
| balance_after | integer | |
| ref_raw / ref_normalized | text | |
| raw | text | encrypted at rest (app-level) |
| client_msg_id | text | dedupe key |
| sim_slot | integer | |
| claimed_payment_id | text FK→payments(id) ON DELETE SET NULL | NULL = unclaimed |
| flags | text[] | |
| received_at / created_at | timestamptz NOT NULL | |

PK = `(provider, trx_id, wallet_id)`. Unique `(provider, wallet_id, client_msg_id)` where `client_msg_id` is not null.

### ledger_entries — double-entry ledger
| id text PK `led_…` | merchant_id FK→merchants RESTRICT | payment_id FK→payments SET NULL | account ledger_account | direction ledger_direction | amount integer >0 | entry_group text | created_at |

### settlements
| id text PK `set_…` | merchant_id FK→merchants RESTRICT | period_start/period_end timestamptz NOT NULL | gross_amount/fee_amount/net_amount integer ≥0 | status settlement_status default `pending` | created_at |

### payouts
| id text PK `po_…` | merchant_id FK→merchants RESTRICT | amount integer >0 | rail payout_rail | destination jsonb | status payout_status default `requested` | requested_by text | approved_by text | approved_at timestamptz | created_at |

### webhook_deliveries
| id text PK `whd_…` | merchant_id FK→merchants CASCADE | payment_id FK→payments SET NULL | event_type text NOT NULL | event_id text NOT NULL `evt_…` | url text NOT NULL | payload jsonb | status webhook_status default `pending` | attempts integer ≥0 | next_attempt_at timestamptz | last_status_code integer | created_at |

### audit_log — append-only
| id text PK `aud_…` | actor text | action text NOT NULL | entity_type/entity_id text | "before"/"after" jsonb | ip text | created_at |

### merchant_users — Auth → merchant mapping
| id text PK `mru_…` | merchant_id FK→merchants CASCADE | auth_user_id uuid NOT NULL | role merchant_role default `viewer` | email text | created_at |
Unique `(merchant_id, auth_user_id)`. **Not FK-constrained to `auth.users`** (so the table is seedable); validate in app.

### api_keys
| id text PK `key_…` | merchant_id FK→merchants CASCADE | key_hash text NOT NULL | prefix text NOT NULL (check `sk_live_%` \| `sk_test_%`) | label text | created_at | revoked_at timestamptz | last_used_at timestamptz |

### device_pairing_codes
| code text PK | merchant_id FK→merchants CASCADE | expires_at timestamptz NOT NULL | used_at timestamptz | created_at |

## Indexes
`payments(reference)` UNIQUE · `payments(merchant_id,status,created_at desc)` · `payments(merchant_id,idempotency_key)` UNIQUE partial · `payments(wallet_id,status)` · `payments(status)` **(v3.1)** · `payments(locked_until)` **(v3.1)** · `incoming_txns(ref_normalized)` · `incoming_txns(client_msg_id)` + UNIQUE partial `(provider,wallet_id,client_msg_id)` · `webhook_deliveries(status,next_attempt_at)` · `wallets(provider,status,last_assigned_at asc nulls first)` · `audit_log(created_at desc)` · plus FK/RLS support indexes.

## Helper functions (SECURITY DEFINER, `search_path = public`)

| signature | returns | purpose |
|---|---|---|
| `assign_wallet(p_provider text, p_merchant_id text)` | `wallets` (row) or NULL | active wallet, device heartbeat < 3 min, `today_total < daily_limit`, pending payments < `concurrency_cap`, ordered by `last_assigned_at asc nulls first`, `FOR UPDATE SKIP LOCKED`; stamps `last_assigned_at = now()`. NULL → map to `503 no_wallet_available`. |
| `claim_incoming_txn(p_provider text, p_trx_id text, p_wallet_id text, p_payment_id text)` | `boolean` | atomic single-use claim: `UPDATE … SET claimed_payment_id = p_payment_id WHERE … AND claimed_payment_id IS NULL`; true only for the winning call. |
| `merchant_balance(p_merchant_id text)` | `bigint` | available balance (paisa) from `ledger_entries`: + `merchant_payable` credits, − `merchant_payable`/`payout`/`refund` debits. |
| `auth_merchant_id()` | `text` | maps `auth.uid()` → merchant via `merchant_users`; used by RLS. |

EXECUTE on the three money helpers is **revoked from PUBLIC/anon/authenticated** and granted to `service_role` only. `auth_merchant_id()` is granted to `authenticated` (returns only the caller's own merchant / NULL for anon).

## RLS

RLS is enabled on **all 14 tables**. Policies (`TO authenticated`, keyed on `merchant_id` via `auth_merchant_id()`):

| table | select | insert | update | delete |
|---|---|---|---|---|
| merchants | ✓ | | ✓ | |
| pricing_plans | ✓ | ✓ | ✓ | ✓ |
| payments | ✓ | ✓ | ✓ | |
| payouts | ✓ | ✓ | | |
| device_pairing_codes | ✓ | ✓ | | |
| ledger_entries / settlements / webhook_deliveries / merchant_users / api_keys | ✓ | | | |

No policies (deny-by-default; `service_role` bypasses): `wallets`, `devices`, `audit_log` (admin fleet/audit), `incoming_txns` (insert-only ingest from the device webhook via `service_role`).

`service_role` has `BYPASSRLS` and full table privileges. `authenticated` is granted only the privileges its policies allow. `anon` is granted nothing — public endpoints (hosted pay page, SMS/device webhooks) run server-side through `service_role`.

> New public tables are not auto-exposed to the Data API (Supabase changelog 2026-04-28; enforced 2026-10-30), so the grants above are explicit.

## v3.1 — Enhanced Checkout / Confirm Flow

Normative source: [`SPEC_v3_1_addendum.md`](../SPEC_v3_1_addendum.md). Applied by migration `20261013000005_v31.sql` (idempotent; re-runnable).

**State machine** (SPEC v3.1 §A): `created → awaiting_payment → confirming → paid`; terminal `expired`, `cancelled`, `needs_review`. `confirming` is set when `POST /v1/pay/:id/confirm` is accepted and no matching SMS is present yet.

| change | detail |
|---|---|
| `payments.status` domain | extended with `confirming`. `payments.status` is the **`payment_status` enum** (not a CHECK), so this is `ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'confirming' AFTER 'awaiting_payment'` — no CHECK constraint exists to drop/recreate (the only named `payments` constraint is `payments_net_check`). |
| `payments.success_url` | text, nullable — redirect target on resolution |
| `payments.cancel_url` | text, nullable — redirect target on cancel/expiry |
| `payments.confirm_attempts` | integer NOT NULL default `0` — lockout counter |
| `payments.confirmed_at` | timestamptz, nullable |
| `payments.locked_until` | timestamptz, nullable — `> now()` → 429 `too_many_attempts` |
| `merchants.auto_confirm` | boolean NOT NULL default `false` — auto-confirm matches (SPEC v3.1 §C) |
| index | `payments(status)` — the composite `payments_merchant_status_created_idx` leads with `merchant_id` and can't serve status-only predicates |
| index | `payments(locked_until)` — backs the lockout check |

RLS and Data API grants are unchanged: the new columns are covered by the existing table-level `SELECT` / `INSERT, UPDATE` grants on `payments` (and `UPDATE` on `merchants`); `payments` stays row-scoped by `merchant_id`. `GET /v1/pay/:id` is public but served server-side via `service_role`.
