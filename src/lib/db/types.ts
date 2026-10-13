/**
 * Canonical database row types for PayGate.
 *
 * These are hand-written to match `docs/db-schema.md` / `supabase/migrations/*` exactly
 * (SPEC §6). Conventions:
 *   - money = `number` (integer paisa, never floats)
 *   - time  = `string` (ISO-8601 UTC; a Postgres `timestamptz`)
 *   - ids   = prefixed `string` (`mer_`, `pay_`, ...)
 *
 * Downstream route handlers/services import these blind — do not widen or rename a column.
 */

import type { Provider } from "@/lib/domain/providers";

// Re-export the provider union from its single source of truth (`@/lib/domain/providers`).
export type { Provider };

/** Recursive JSON value — the shape of every `jsonb` column (no `any`). */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------
// Enum unions (mirror the Postgres enums in migration 0001)
// ---------------------------------------------------------------------------

export type MerchantStatus = "pending" | "active" | "suspended";
export type KybStatus = "pending" | "under_review" | "approved" | "rejected";
export type RiskTier = "low" | "medium" | "high";
export type PlanStatus = "active" | "archived";
export type WalletStatus = "active" | "draining" | "disabled";
export type DeviceStatus = "active" | "revoked";
/** SPEC §3: `created -> awaiting_payment -> paid`; terminal: `expired`, `cancelled`, `needs_review`. */
export type PaymentStatus =
  | "created"
  | "awaiting_payment"
  | "paid"
  | "expired"
  | "cancelled"
  | "needs_review";
export type ReviewReason =
  | "underpaid"
  | "overpaid"
  | "wrong_wallet"
  | "late_payment"
  | "duplicate_ref"
  | "conflict"
  | "unmatched";
export type MatchedBy = "reference" | "trxid";
export type LedgerAccount = "payin" | "fee" | "merchant_payable" | "payout" | "refund";
export type LedgerDirection = "debit" | "credit";
export type SettlementStatus = "pending" | "processing" | "paid";
export type PayoutRail = "bank" | "mfs";
export type PayoutStatus = "requested" | "approved" | "rejected" | "paid";
export type WebhookStatus = "pending" | "success" | "failed";
/** Supabase Auth roles (SPEC §9). */
export type Role = "owner" | "staff" | "developer" | "viewer";

/** API key scheme prefix — matches the `api_keys.prefix` check constraint. */
export type ApiKeyPrefix = "sk_live_" | "sk_test_";

// ---------------------------------------------------------------------------
// JSON column shapes (documented in SPEC §6 / db.md)
// ---------------------------------------------------------------------------

/** `merchants.payout_account` — bank account or MFS wallet. */
export interface PayoutAccount {
  type?: "bank" | "mfs";
  provider?: Provider;
  account_no?: string;
  holder?: string;
  bank_name?: string;
  [key: string]: Json | undefined;
}

/** `payouts.destination`. */
export interface PayoutDestination {
  account_no?: string;
  holder?: string;
  bank_name?: string;
  provider?: Provider;
  [key: string]: Json | undefined;
}

/** Snapshot of a pricing plan captured on the payment at creation time. */
export interface PlanSnapshot {
  id?: string;
  name?: string;
  amount?: number | null;
  currency?: string;
  version?: number;
  [key: string]: Json | undefined;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Merchant {
  id: string;
  name: string;
  status: MerchantStatus;
  kyb_status: KybStatus;
  payout_account: PayoutAccount | null;
  fee_rate_bps: number;
  risk_tier: RiskTier;
  webhook_secret_hash: string | null;
  created_at: string;
}

export interface PricingPlan {
  id: string;
  merchant_id: string;
  name: string;
  /** paisa; `null` when `open_amount` is true. */
  amount: number | null;
  currency: string;
  external_sku: string | null;
  version: number;
  status: PlanStatus;
  open_amount: boolean;
  min_amount: number | null;
  max_amount: number | null;
  created_at: string;
}

export interface Wallet {
  id: string;
  provider: Provider;
  msisdn: string;
  holder_name: string | null;
  device_id: string | null;
  sim_slot: number | null;
  status: WalletStatus;
  /** paisa */
  daily_limit: number;
  /** paisa */
  monthly_limit: number | null;
  /** paisa */
  today_total: number;
  concurrency_cap: number;
  last_assigned_at: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  name: string | null;
  model: string | null;
  app_version: string | null;
  /** hashed 256-bit device token; `null` until pairing completes. */
  token_hash: string | null;
  status: DeviceStatus;
  last_heartbeat_at: string | null;
  battery: number | null;
  queue_depth: number;
  permissions: Json;
  created_at: string;
}

export interface Payment {
  id: string;
  merchant_id: string;
  plan_id: string | null;
  plan_snapshot: PlanSnapshot | null;
  order_id: string | null;
  provider: Provider;
  wallet_id: string | null;
  offered_wallet_ids: string[] | null;
  /** paisa */
  amount: number;
  /** paisa */
  fee_amount: number;
  /** paisa; invariant `net_amount = amount - fee_amount`. */
  net_amount: number;
  reference: string;
  status: PaymentStatus;
  review_reason: ReviewReason | null;
  matched_by: MatchedBy | null;
  submitted_trx_id: string | null;
  idempotency_key: string | null;
  callback_url: string | null;
  metadata: Json | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Ingested SMS transaction. Natural key `(provider, trx_id, wallet_id)` — no `id` column. */
export interface IncomingTxn {
  provider: Provider;
  trx_id: string;
  wallet_id: string;
  /** paisa */
  amount: number;
  /** paisa */
  balance_after: number | null;
  ref_raw: string | null;
  ref_normalized: string | null;
  /** app-level encrypted raw SMS. */
  raw: string | null;
  client_msg_id: string | null;
  sim_slot: number | null;
  claimed_payment_id: string | null;
  flags: string[] | null;
  received_at: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  merchant_id: string;
  payment_id: string | null;
  account: LedgerAccount;
  direction: LedgerDirection;
  /** paisa, always > 0 (sign is carried by `direction`). */
  amount: number;
  entry_group: string;
  created_at: string;
}

export interface Settlement {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  /** paisa */
  gross_amount: number;
  /** paisa */
  fee_amount: number;
  /** paisa */
  net_amount: number;
  status: SettlementStatus;
  created_at: string;
}

export interface Payout {
  id: string;
  merchant_id: string;
  /** paisa */
  amount: number;
  rail: PayoutRail;
  destination: PayoutDestination | null;
  status: PayoutStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  merchant_id: string;
  payment_id: string | null;
  event_type: string;
  event_id: string;
  url: string;
  payload: Json | null;
  status: WebhookStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

/** Append-only audit trail. `before`/`after` are the quoted SQL identifiers. */
export interface AuditLog {
  id: string;
  actor: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: Json | null;
  after: Json | null;
  ip: string | null;
  created_at: string;
}

export interface MerchantUser {
  id: string;
  merchant_id: string;
  /** Supabase Auth user id (`auth.users.id`); not FK-constrained (see db.md §6.5). */
  auth_user_id: string;
  role: Role;
  email: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  merchant_id: string;
  key_hash: string;
  prefix: ApiKeyPrefix;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface DevicePairingCode {
  code: string;
  merchant_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}
