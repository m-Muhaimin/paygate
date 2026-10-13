/**
 * Public, customer-facing fetchers.
 *
 * Reuses the shared client data layer (`@/lib/client/query`): same
 * `ApiClientError`, same `{ error: {...} }` envelope handling, same QueryClient
 * singleton. This module only adds the unauthenticated pay-page and onboarding
 * surface; it must not re-declare types or helpers that already exist there.
 *
 * Route handlers live under `src/app/api/v1/**` (SPEC §7), so the HTTP paths
 * below are `/api/v1/...`. `NEXT_PUBLIC_PAYGATE_API_BASE` can point the client
 * at a different origin/prefix without a code change.
 */

import {
  apiFetch,
  type MatchedBy,
  type MerchantStatus,
  type PaymentStatus,
  type Provider,
  type ReviewReason,
} from "@/lib/client/query";

/** Base URL for the public v1 API. Trailing slash trimmed. */
export const API_BASE =
  process.env.NEXT_PUBLIC_PAYGATE_API_BASE?.replace(/\/+$/, "") ?? "/api/v1";

/** The receiving wallet as the customer sees it. */
export interface PayLinkWallet {
  provider: Provider;
  /** Full MSISDN the customer must send money to. */
  number: string;
  holder_name: string | null;
}

/** `GET /v1/pay/:id` response. `amount` is integer paisa (SPEC §1). */
export interface PayLink {
  id: string;
  status: PaymentStatus;
  /** Integer paisa (BDT x 100). */
  amount: number;
  /** Server-formatted `Tk ...` string (merchant listing convenience); the pay
   *  page renders its own locale-aware `৳` string instead. */
  amount_bdt?: string;
  provider: Provider;
  /** 8-character reference (SPEC §2). */
  reference: string;
  wallet: PayLinkWallet | null;
  /** ISO-8601 UTC; null only if a wallet/payment lost its expiry mid-flight. */
  expires_at: string | null;
  /** Redirect target after a resolved successful payment (v3.1 redirect mode). */
  success_url: string | null;
  /** Redirect target after expiry/cancellation (v3.1 redirect mode). */
  cancel_url: string | null;
  /** Server-enforced confirm attempts left before a 15-minute lockout. */
  attempts_remaining: number;
  /** True when the merchant requires the customer's TrxID to match. */
  trxid_required: boolean;
  review_reason: ReviewReason | null;
}

/** The subset of the resolved payment returned inside a confirm response. */
export interface ConfirmPayment {
  id?: string;
  status?: PaymentStatus;
  /** Integer paisa. */
  amount?: number;
  order_id?: string | null;
  reference?: string;
  matched_by?: MatchedBy | null;
  review_reason?: ReviewReason | null;
  /**
   * Amount actually received, in integer paisa, when the server knows it
   * (used for the "we received X but expected Y" review copy). Optional: the
   * v3.1 contract does not require it, so the UI degrades to a generic line.
   */
  received_amount?: number | null;
}

/** `POST /v1/pay/:id/confirm` response (SPEC v3.1 §B). */
export interface ConfirmResult {
  status: PaymentStatus;
  matched_by?: MatchedBy | null;
  review_reason?: ReviewReason | null;
  payment?: ConfirmPayment | null;
}

/** `POST /v1/pay/:id/submit-trx` response. */
export interface SubmitTrxResult {
  ok: true;
  status: PaymentStatus;
}

/** `POST /v1/onboarding/apply` request body (SPEC §7, server schema). */
export interface OnboardingApplyInput {
  name: string;
  email: string;
  phone: string;
  business_type: string;
  payout_account: {
    type?: "bank" | "mfs";
    provider?: Provider;
    account_no?: string;
    holder?: string;
    bank_name?: string;
  };
}

/** `POST /v1/onboarding/apply` response (HTTP 201). */
export interface OnboardingApplyResult {
  merchant_id: string;
  status: MerchantStatus;
}

/** `GET /v1/pay/:id` — public pay-link detail. */
export function getPay(id: string, signal?: AbortSignal): Promise<PayLink> {
  return apiFetch<PayLink>(`${API_BASE}/pay/${encodeURIComponent(id)}`, {
    signal,
    cache: "no-store",
  });
}

/** `POST /v1/pay/:id/submit-trx` — customer-supplied TrxID fallback. */
export function submitTrx(
  id: string,
  trxId: string,
  signal?: AbortSignal,
): Promise<SubmitTrxResult> {
  return apiFetch<SubmitTrxResult>(
    `${API_BASE}/pay/${encodeURIComponent(id)}/submit-trx`,
    { method: "POST", body: JSON.stringify({ trx_id: trxId }), signal },
  );
}

/**
 * `POST /v1/pay/:id/confirm` — the v3.1 Confirm flow. The request may hold for
 * up to ~90s while the server waits for a matching SMS, so callers must not
 * attach a short timeout; `{ status: "confirming" }` means "still checking".
 */
export function confirmPay(
  id: string,
  trxId: string,
  signal?: AbortSignal,
): Promise<ConfirmResult> {
  return apiFetch<ConfirmResult>(
    `${API_BASE}/pay/${encodeURIComponent(id)}/confirm`,
    { method: "POST", body: JSON.stringify({ trx_id: trxId }), signal },
  );
}

/** Mutating a payment is never safe to auto-retry. */
export const CONFIRM_MAX_ATTEMPTS = 5;

/** Server rule for the Confirm TrxID: 6–24 alphanumeric characters (§B.2). */
const TRX_ID_PATTERN = /^[A-Za-z0-9]{6,24}$/;

/** Client-side mirror of the confirm `trx_id` format check. */
export function isValidTrxId(value: string): boolean {
  return TRX_ID_PATTERN.test(value.trim());
}

/** `POST /v1/onboarding/apply` — merchant KYB application. */
export function applyOnboarding(
  input: OnboardingApplyInput,
  signal?: AbortSignal,
): Promise<OnboardingApplyResult> {
  return apiFetch<OnboardingApplyResult>(`${API_BASE}/onboarding/apply`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

/** Terminal payment states: polling must stop once one is reached (SPEC §3). */
export function isTerminalStatus(
  status: PaymentStatus | undefined,
): boolean {
  return (
    status === "paid" ||
    status === "expired" ||
    status === "cancelled" ||
    status === "needs_review"
  );
}

/** TanStack Query keys for the public pay resource. */
export const payKeys = {
  all: ["pay"] as const,
  detail: (id: string) => ["pay", id] as const,
};

/** Re-exported for consumers that only import from the public surface. */
export type {
  MerchantStatus,
  PaymentStatus,
  Provider,
  ReviewReason,
} from "@/lib/client/query";