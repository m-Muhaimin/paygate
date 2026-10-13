"use client";

/**
 * Client data layer: typed fetchers, the canonical error envelope, query keys,
 * and the TanStack Query provider.
 *
 * Server contract (SPEC v3 §7):
 *   - errors  -> `{ error: { code, message, request_id } }`
 *   - lists   -> `{ data: [...] }`
 *   - money   -> integer paisa (BDT x 100)
 *   - time    -> ISO-8601 UTC strings
 *
 * No live database exists yet, so every fetcher is written to degrade into a
 * typed `ApiClientError` that the UI renders as an error/empty state rather
 * than crashing.
 */

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Provider = "bkash" | "nagad" | "rocket";

export type PaymentStatus =
  | "created"
  | "awaiting_payment"
  /** Set while `POST /v1/pay/:id/confirm` holds with no matching SMS yet. */
  | "confirming"
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
export type PlanStatus = "active" | "archived";
export type WalletStatus = "active" | "draining" | "disabled";
export type DeviceStatus = "active" | "revoked";
export type SettlementStatus = "pending" | "processing" | "paid";
export type PayoutRail = "bank" | "mfs";
export type PayoutStatus = "requested" | "approved" | "rejected" | "paid";
export type KybStatus = "pending" | "under_review" | "approved" | "rejected";
export type MerchantStatus = "pending" | "active" | "suspended";
export type Role = "owner" | "staff" | "developer" | "viewer";

/* -------------------------------------------------------------------------- */
/* Error envelope                                                              */
/* -------------------------------------------------------------------------- */

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

export interface ApiClientErrorInit {
  code: string;
  message: string;
  status: number;
  requestId?: string;
  envelope?: ApiErrorEnvelope;
  cause?: unknown;
}

/** Normalised, UI-renderable API failure. */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly envelope?: ApiErrorEnvelope;

  constructor(init: ApiClientErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = "ApiClientError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.envelope = init.envelope;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

/** Human copy for any thrown value, safe to drop into a Banner/EmptyState. */
export function errorMessage(error: unknown): string {
  if (isApiClientError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

async function mapError(res: Response): Promise<ApiClientError> {
  let envelope: ApiErrorEnvelope | undefined;
  try {
    const text = await res.text();
    if (text) {
      const json: unknown = JSON.parse(text);
      if (
        json &&
        typeof json === "object" &&
        "error" in json &&
        json.error &&
        typeof json.error === "object" &&
        "code" in json.error &&
        typeof (json.error as { code: unknown }).code === "string"
      ) {
        envelope = json as ApiErrorEnvelope;
      }
    }
  } catch {
    // Non-JSON body (e.g. an HTML 404 from the framework) — fall through.
  }

  const code =
    envelope?.error.code ??
    (res.status === 404 ? "not_found" : "http_error");
  const message =
    envelope?.error.message ??
    (res.status === 404
      ? "This resource is not available yet."
      : `Request failed (${res.status}).`);

  return new ApiClientError({
    code,
    message,
    status: res.status,
    requestId: envelope?.error.request_id,
    envelope,
  });
}

/** Fetch JSON, surfacing the canonical error envelope as `ApiClientError`. */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      credentials: init.credentials ?? "same-origin",
    });
  } catch (cause) {
    throw new ApiClientError({
      code: "network_error",
      message: "Could not reach PayGate. Check your connection and retry.",
      status: 0,
      cause,
    });
  }

  if (!res.ok) throw await mapError(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiClientError({
      code: "invalid_response",
      message: "The server returned an unexpected response.",
      status: res.status,
    });
  }
}

/** Unwrap a `{ data: [...] }` list envelope (falls back to a bare array). */
function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

/** Fetch a list endpoint and unwrap `{ data: [...] }`. */
export async function apiList<T>(
  path: string,
  init: RequestInit = {}
): Promise<T[]> {
  return asList<T>(await apiFetch<unknown>(path, init));
}

/** Unwrap an `{ data: T }` single envelope (falls back to the payload). */
function asItem<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    (payload as { data: unknown }).data !== undefined &&
    !Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/** Fetch a single-item endpoint and unwrap `{ data: T }`. */
export async function apiItem<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  return asItem<T>(await apiFetch<unknown>(path, init));
}

/** Build a query string from defined values. */
export function qs(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

function jsonBody(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

/* -------------------------------------------------------------------------- */
/* Resource types                                                              */
/* -------------------------------------------------------------------------- */

export interface Balance {
  available: number;
  pending_payouts: number;
  lifetime_gross: number;
  lifetime_fees: number;
  lifetime_net: number;
  currency: string;
}

export interface PayoutAccount {
  type?: PayoutRail;
  provider?: Provider;
  account_no?: string;
  holder?: string;
  bank_name?: string;
}

export interface Merchant {
  id: string;
  name: string;
  status: MerchantStatus;
  kyb_status: KybStatus;
  payout_account: PayoutAccount | null;
  fee_rate_bps: number;
  risk_tier: "low" | "medium" | "high";
  created_at: string;
  /** Optional aggregates some deployments return on `/v1/merchants/me`. */
  two_factor_enabled?: boolean;
}

export interface PlanSnapshot {
  id?: string;
  name?: string;
  amount?: number | null;
  currency?: string;
  version?: number;
}

export interface Payment {
  id: string;
  merchant_id: string;
  plan_id: string | null;
  plan_snapshot: PlanSnapshot | null;
  order_id: string | null;
  provider: Provider;
  wallet_id: string | null;
  amount: number;
  fee_amount: number;
  net_amount: number;
  reference: string;
  status: PaymentStatus;
  review_reason: ReviewReason | null;
  matched_by: MatchedBy | null;
  submitted_trx_id: string | null;
  callback_url: string | null;
  metadata: Json | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  merchant_id: string;
  name: string;
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

export interface PlanInput {
  name: string;
  amount: number | null;
  external_sku: string | null;
  open_amount: boolean;
  min_amount: number | null;
  max_amount: number | null;
}

export interface Settlement {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  status: SettlementStatus;
  created_at: string;
}

export interface PayoutDestination {
  account_no?: string;
  holder?: string;
  bank_name?: string;
  provider?: Provider;
}

export interface Payout {
  id: string;
  merchant_id: string;
  amount: number;
  rail: PayoutRail;
  destination: PayoutDestination | null;
  status: PayoutStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** Optional checker note / rejection reason. */
  note?: string | null;
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
  daily_limit: number;
  monthly_limit: number | null;
  today_total: number;
  concurrency_cap: number;
  last_assigned_at: string | null;
  created_at: string;
}

export interface WalletInput {
  provider: Provider;
  msisdn: string;
  holder_name: string | null;
  daily_limit: number;
  monthly_limit: number | null;
  concurrency_cap: number;
  status: WalletStatus;
}

export interface DevicePermissions {
  sms?: boolean;
  notifications?: boolean;
  battery_optimisation?: boolean;
  [key: string]: boolean | undefined;
}

export interface Device {
  id: string;
  name: string | null;
  model: string | null;
  app_version: string | null;
  status: DeviceStatus;
  last_heartbeat_at: string | null;
  battery: number | null;
  queue_depth: number;
  permissions: DevicePermissions | null;
  created_at: string;
}

export interface PairingCode {
  code: string;
  expires_at: string;
  merchant_id?: string;
}

export interface IncomingTxn {
  provider: Provider;
  trx_id: string;
  wallet_id: string;
  amount: number;
  balance_after: number | null;
  ref_raw: string | null;
  ref_normalized: string | null;
  client_msg_id: string | null;
  sim_slot: number | null;
  claimed_payment_id: string | null;
  flags: string[] | null;
  received_at: string;
  created_at: string;
}

export interface ReviewCase {
  id: string;
  reason: ReviewReason | null;
  created_at: string;
  /** The pending payment this incoming txn plausibly belongs to. */
  payment: Payment | null;
  /** The raw incoming transaction awaiting a decision. */
  incoming: IncomingTxn | null;
  /** Check-char suggestion, never auto-applied (SPEC §4). */
  suggested_reference: string | null;
  /** Other payments that could be the match. */
  candidates: Payment[];
}

export interface AuditEntry {
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

export interface ApiKey {
  id: string;
  label: string | null;
  /** Scheme + last 4, e.g. `sk_live_…abcd`. */
  masked_key: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface CreatedApiKey extends ApiKey {
  /** Returned exactly once, at creation. */
  plaintext: string;
}

export interface WebhookDelivery {
  id: string;
  payment_id: string | null;
  event_type: string;
  event_id: string;
  url: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  email: string | null;
  role: Role;
  created_at: string;
  two_factor_enabled?: boolean;
}

export interface PaymentFilters {
  status?: PaymentStatus | "all";
  provider?: Provider | "all";
  q?: string;
  limit?: number;
  cursor?: string;
}

/* -------------------------------------------------------------------------- */
/* Query keys                                                                  */
/* -------------------------------------------------------------------------- */

export const queryKeys = {
  balance: ["balance"] as const,
  me: ["merchants", "me"] as const,
  payments: (filters: PaymentFilters = {}) => ["payments", filters] as const,
  payment: (id: string) => ["payments", id] as const,
  plans: ["plans"] as const,
  settlements: ["settlements"] as const,
  payouts: ["payouts"] as const,
  apiKeys: ["api-keys"] as const,
  webhookDeliveries: ["webhooks", "deliveries"] as const,
  team: ["team"] as const,
  adminWallets: ["admin", "wallets"] as const,
  adminDevices: ["admin", "devices"] as const,
  adminReview: ["admin", "review"] as const,
  adminPayouts: ["admin", "payouts"] as const,
  adminMerchants: ["admin", "merchants"] as const,
  adminAudit: (filters: AuditFilters = {}) => ["admin", "audit", filters] as const,
} as const;

/* -------------------------------------------------------------------------- */
/* Merchant fetchers                                                           */
/* -------------------------------------------------------------------------- */

export async function getBalance(): Promise<Balance> {
  return apiFetch<Balance>("/v1/balance");
}

export async function getMe(): Promise<Merchant> {
  return apiItem<Merchant>("/v1/merchants/me");
}

export async function getPayments(
  filters: PaymentFilters = {}
): Promise<Payment[]> {
  // The server's `listQuerySchema` is `.strict()` and accepts only
  // status/provider/limit/cursor, so `q` must never go on the wire — the
  // payments page filters by search text locally (`matchesFilters`).
  return apiList<Payment>(
    `/v1/payments${qs({
      status: filters.status === "all" ? undefined : filters.status,
      provider: filters.provider === "all" ? undefined : filters.provider,
      limit: filters.limit,
      cursor: filters.cursor,
    })}`
  );
}

export async function getPayment(id: string): Promise<Payment> {
  return apiItem<Payment>(`/v1/payments/${encodeURIComponent(id)}`);
}

export async function cancelPayment(id: string): Promise<Payment> {
  return apiItem<Payment>(
    `/v1/payments/${encodeURIComponent(id)}/cancel`,
    { method: "POST" }
  );
}

export async function getPlans(): Promise<Plan[]> {
  return apiList<Plan>("/v1/plans");
}

export async function createPlan(input: PlanInput): Promise<Plan> {
  return apiItem<Plan>("/v1/plans", jsonBody(input));
}

/** Editing a plan creates a new version server-side (SPEC §7). */
export async function updatePlan(
  id: string,
  input: Partial<PlanInput> & { status?: PlanStatus }
): Promise<Plan> {
  return apiItem<Plan>(`/v1/plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getSettlements(): Promise<Settlement[]> {
  return apiList<Settlement>("/v1/settlements");
}

export function settlementsExportUrl(params: {
  period_start?: string;
  period_end?: string;
  format?: "csv";
} = {}): string {
  return `/v1/settlements/export${qs({ format: "csv", ...params })}`;
}

export async function getPayouts(): Promise<Payout[]> {
  return apiList<Payout>("/v1/payouts");
}

export interface PayoutInput {
  amount: number;
  rail: PayoutRail;
  destination: PayoutDestination;
}

export async function createPayout(input: PayoutInput): Promise<Payout> {
  return apiItem<Payout>("/v1/payouts", jsonBody(input));
}

/* Developers — assumed contract, see report (not yet in the brief's endpoint list). */

export async function getApiKeys(): Promise<ApiKey[]> {
  return apiList<ApiKey>("/v1/api-keys");
}

export async function createApiKey(input: {
  label: string;
  mode: "live" | "test";
}): Promise<CreatedApiKey> {
  return apiItem<CreatedApiKey>("/v1/api-keys", jsonBody(input));
}

export async function revokeApiKey(id: string): Promise<void> {
  await apiFetch<void>(`/v1/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}

export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> {
  return apiList<WebhookDelivery>("/v1/webhooks/deliveries");
}

export async function resendWebhookDelivery(id: string): Promise<void> {
  await apiFetch<void>(
    `/v1/webhooks/deliveries/${encodeURIComponent(id)}/resend`,
    { method: "POST" }
  );
}

export async function rotateWebhookSecret(): Promise<{ secret: string }> {
  return apiItem<{ secret: string }>("/v1/merchants/me/webhook-secret/rotate", {
    method: "POST",
  });
}

export async function getTeam(): Promise<TeamMember[]> {
  return apiList<TeamMember>("/v1/merchants/me/team");
}

export async function updateMe(
  input: Partial<Pick<Merchant, "name" | "payout_account">>
): Promise<Merchant> {
  return apiItem<Merchant>("/v1/merchants/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/* -------------------------------------------------------------------------- */
/* Admin fetchers                                                              */
/* -------------------------------------------------------------------------- */

export async function getAdminWallets(): Promise<Wallet[]> {
  return apiList<Wallet>("/v1/admin/wallets");
}

export async function createAdminWallet(input: WalletInput): Promise<Wallet> {
  return apiItem<Wallet>("/v1/admin/wallets", jsonBody(input));
}

export async function updateAdminWallet(
  id: string,
  input: Partial<WalletInput>
): Promise<Wallet> {
  return apiItem<Wallet>(`/v1/admin/wallets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function getAdminDevices(): Promise<Device[]> {
  return apiList<Device>("/v1/admin/devices");
}

export async function revokeDevice(id: string): Promise<void> {
  await apiFetch<void>(`/v1/admin/devices/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
  });
}

export async function flushDevice(id: string): Promise<void> {
  await apiFetch<void>(`/v1/admin/devices/${encodeURIComponent(id)}/flush`, {
    method: "POST",
  });
}

export async function createPairingCode(): Promise<PairingCode> {
  return apiItem<PairingCode>("/v1/admin/devices/pairing-code", {
    method: "POST",
  });
}

export async function getAdminReview(): Promise<ReviewCase[]> {
  return apiList<ReviewCase>("/v1/admin/review");
}

export interface ReviewResolution {
  resolution: "matched" | "accepted" | "rejected";
  note: string;
  payment_id?: string | null;
}

export async function resolveReview(
  id: string,
  input: ReviewResolution
): Promise<void> {
  await apiFetch<void>(
    `/v1/admin/review/${encodeURIComponent(id)}/resolve`,
    jsonBody(input)
  );
}

export async function getAdminPayouts(): Promise<Payout[]> {
  return apiList<Payout>("/v1/admin/payouts");
}

export async function approvePayout(id: string, note?: string): Promise<void> {
  await apiFetch<void>(
    `/v1/admin/payouts/${encodeURIComponent(id)}/approve`,
    jsonBody({ note: note ?? null })
  );
}

export async function rejectPayout(id: string, reason: string): Promise<void> {
  await apiFetch<void>(
    `/v1/admin/payouts/${encodeURIComponent(id)}/reject`,
    jsonBody({ reason })
  );
}

export interface AdminMerchant extends Merchant {
  lifetime_gross?: number;
  payment_count?: number;
}

export async function getAdminMerchants(): Promise<AdminMerchant[]> {
  return apiList<AdminMerchant>("/v1/admin/merchants");
}

export async function decideKyb(
  id: string,
  decision: "approved" | "rejected",
  note?: string
): Promise<void> {
  await apiFetch<void>(
    `/v1/admin/merchants/${encodeURIComponent(id)}/kyb`,
    jsonBody({ decision, note: note ?? null })
  );
}

export type AuditFilters = {
  action?: string;
  entity_type?: string;
  actor?: string;
  q?: string;
};

export async function getAdminAudit(
  filters: AuditFilters = {}
): Promise<AuditEntry[]> {
  return apiList<AuditEntry>(`/v1/admin/audit${qs({ ...filters })}`);
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                     */
/* -------------------------------------------------------------------------- */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | null = null;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(getQueryClient);
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
