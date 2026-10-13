-- PayGate platform — migration 0002: indexes
-- Covers the hot paths from SPEC §4 (matching), §5 (wallet assignment), §8 (webhook retries),
-- plus RLS/FK support. All created IF NOT EXISTS so the migration is re-runnable.

-- payments -----------------------------------------------------------------
-- SPEC §2: reference is single-use and unique (case-insensitive matching happens after
-- normalisation in the app, so the stored value is already normalised/uppercase).
create unique index if not exists payments_reference_key
  on payments (reference);

-- Merchant payment listing (SPEC §7 GET /v1/payments): newest first, filtered by status.
create index if not exists payments_merchant_status_created_idx
  on payments (merchant_id, status, created_at desc);

-- Idempotency: unique per merchant, only where a key was supplied (SPEC §7 POST /v1/payments).
create unique index if not exists payments_merchant_idempotency_key
  on payments (merchant_id, idempotency_key)
  where idempotency_key is not null;

-- assign_wallet() counts pending payments per wallet (SPEC §5).
create index if not exists payments_wallet_status_idx
  on payments (wallet_id, status);

-- Lookups by order id / submitted trx id / plan.
create index if not exists payments_order_id_idx
  on payments (order_id);
create index if not exists payments_submitted_trx_id_idx
  on payments (submitted_trx_id);
create index if not exists payments_plan_id_idx
  on payments (plan_id);

-- incoming_txns ------------------------------------------------------------
-- SPEC §4: reference matching looks up by normalised ref.
create index if not exists incoming_txns_ref_normalized_idx
  on incoming_txns (ref_normalized);

-- SPEC §4: dedupe identical SMS by client_msg_id.
create index if not exists incoming_txns_client_msg_id_idx
  on incoming_txns (client_msg_id);
create unique index if not exists incoming_txns_wallet_client_msg_key
  on incoming_txns (provider, wallet_id, client_msg_id)
  where client_msg_id is not null;

-- Matching/claim + review queue.
create index if not exists incoming_txns_claimed_payment_idx
  on incoming_txns (claimed_payment_id);
create index if not exists incoming_txns_received_at_idx
  on incoming_txns (received_at desc);

-- webhook_deliveries -------------------------------------------------------
-- SPEC §8: retry worker scans pending deliveries due for the next attempt.
create index if not exists webhook_deliveries_status_next_attempt_idx
  on webhook_deliveries (status, next_attempt_at);
create index if not exists webhook_deliveries_merchant_idx
  on webhook_deliveries (merchant_id, created_at desc);
create index if not exists webhook_deliveries_payment_idx
  on webhook_deliveries (payment_id);

-- wallets ------------------------------------------------------------------
-- SPEC §5: assign_wallet() filters by provider + status and orders by last_assigned_at.
create index if not exists wallets_provider_status_last_assigned_idx
  on wallets (provider, status, last_assigned_at asc nulls first);
create index if not exists wallets_device_id_idx
  on wallets (device_id);

-- audit_log ----------------------------------------------------------------
create index if not exists audit_log_created_at_idx
  on audit_log (created_at desc);
create index if not exists audit_log_entity_idx
  on audit_log (entity_type, entity_id);

-- RLS / FK support ---------------------------------------------------------
-- auth_merchant_id() resolves the caller's merchant from merchant_users.
create index if not exists merchant_users_auth_user_id_idx
  on merchant_users (auth_user_id);
create index if not exists merchant_users_merchant_id_idx
  on merchant_users (merchant_id);

create index if not exists pricing_plans_merchant_idx
  on pricing_plans (merchant_id, status);
create index if not exists ledger_entries_merchant_account_idx
  on ledger_entries (merchant_id, account);
create index if not exists ledger_entries_payment_idx
  on ledger_entries (payment_id);
create index if not exists settlements_merchant_period_idx
  on settlements (merchant_id, period_start desc);
create index if not exists payouts_merchant_status_idx
  on payouts (merchant_id, status, created_at desc);
create index if not exists api_keys_merchant_idx
  on api_keys (merchant_id);
create index if not exists device_pairing_codes_merchant_idx
  on device_pairing_codes (merchant_id);
create index if not exists devices_status_idx
  on devices (status, last_heartbeat_at desc);
