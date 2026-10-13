/**
 * Payments service (SPEC §3 states, §4 matching, §5 wallet assignment, §6 `payments`).
 *
 * A payment pins a plan at creation time (`plan_snapshot`), offers exactly one
 * receiving wallet (`offered_wallet_ids = [wallet.id]`) chosen by `assign_wallet`,
 * and carries a single-use 8-char reference. The hosted pay page and the SMS
 * matcher both key off the same row — `GET /v1/payments/:id` is the source of truth.
 */

import { z } from "zod";

import {
  badRequest,
  conflict,
  internal,
  noWalletAvailable,
  notFound,
  unprocessable,
} from "@/lib/api/errors";
import { withIdempotency } from "@/lib/api/idempotency";
import { db } from "@/lib/db/client";
import { assignWallet } from "@/lib/db/rpc";
import { newId, PRE } from "@/lib/domain/ids";
import { computeFee, computeNet, formatBdt } from "@/lib/domain/money";
import { PROVIDERS } from "@/lib/domain/providers";
import { generateReference } from "@/lib/domain/reference";
import type {
  Json,
  Merchant,
  Payment,
  PaymentStatus,
  PlanSnapshot,
  PricingPlan,
  Provider,
  ReviewReason,
  Wallet,
} from "@/lib/db/types";

import type { PaymentWithWallet, WalletView } from "./serializers";
import { toWalletView } from "./serializers";

/** PostgREST select that embeds the receiving wallet. */
const PAYMENT_SELECT = "*, wallets(provider, msisdn, holder_name)";

const TERMINAL_STATUSES: PaymentStatus[] = ["paid", "expired", "cancelled", "needs_review"];
const MAX_REFERENCE_ATTEMPTS = 5;
const DEFAULT_TTL_MIN = 30;

/**
 * Non-terminal statuses, including the v3.1 `confirming` state (SPEC v3.1 §A:
 * `created -> awaiting_payment -> confirming -> paid`). `confirming` payments are
 * still cancellable and still accept a TrxID submission.
 */
type OpenStatus = PaymentStatus | "confirming";
const OPEN_STATUSES: OpenStatus[] = ["created", "awaiting_payment", "confirming"];

export const createPaymentSchema = z
  .object({
    plan_id: z.string().trim().min(1),
    order_id: z.string().trim().min(1).max(200),
    provider: z.enum(["bkash", "nagad", "rocket"]),
    callback_url: z.string().url().max(2000).nullish(),
    /** v3.1 redirect targets (SPEC v3.1 §B) — optional, validated as URLs. */
    success_url: z.string().url().max(2000).nullish(),
    cancel_url: z.string().url().max(2000).nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

export const submitTrxSchema = z
  .object({
    trx_id: z.string().trim().min(4).max(64),
  })
  .strict();

export interface CreatePaymentInput {
  merchant: Merchant;
  planId: string;
  orderId: string;
  provider: Provider;
  callbackUrl?: string | null;
  /** v3.1 redirect target on success (SPEC v3.1 §D). */
  successUrl?: string | null;
  /** v3.1 redirect target on cancel/expiry (SPEC v3.1 §D). */
  cancelUrl?: string | null;
  metadata?: Json | null;
  idempotencyKey: string | null;
  /** Origin (`scheme://host`) used to build the absolute `pay_url`. */
  origin: string;
}

export interface CreatePaymentResult {
  payment: Payment;
  wallet: Wallet | null;
  payUrl: string;
}

export interface ListPaymentsFilters {
  /** `confirming` (SPEC v3.1 §A) is a valid filter even though the canonical `PaymentStatus` predates it. */
  status?: PaymentStatus | "confirming";
  provider?: Provider;
  limit?: number;
  cursor?: string | null;
}

export interface ListPaymentsResult {
  data: PaymentWithWallet[];
  next_cursor: string | null;
}

export interface PayPageView {
  id: string;
  status: PaymentStatus;
  /** integer paisa */
  amount: number;
  amount_bdt: string;
  provider: Provider;
  reference: string;
  wallet: WalletView | null;
  expires_at: string | null;
  trxid_required: boolean;
  review_reason: ReviewReason | null;
}

/** Payment TTL in ms (`PAYMENT_TTL_MIN`, default 30). */
function paymentTtlMs(): number {
  const raw = Number(process.env.PAYMENT_TTL_MIN);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MIN;
  return minutes * 60_000;
}

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/** Which unique constraint a `23505` came from (`reference` vs `idempotency_key`). */
function uniqueViolationTarget(error: SupabaseLikeError): "reference" | "idempotency_key" | null {
  const text = `${error.details ?? ""} ${error.message ?? ""}`;
  if (/idempotency_key/i.test(text)) return "idempotency_key";
  if (/reference/i.test(text)) return "reference";
  return null;
}

interface NewPaymentPayload {
  id: string;
  merchant_id: string;
  plan_id: string;
  plan_snapshot: PlanSnapshot;
  order_id: string;
  provider: Provider;
  wallet_id: string;
  offered_wallet_ids: string[];
  amount: number;
  fee_amount: number;
  net_amount: number;
  status: PaymentStatus;
  idempotency_key: string | null;
  callback_url: string | null;
  success_url: string | null;
  cancel_url: string | null;
  metadata: Json | null;
  expires_at: string;
}

/**
 * Insert a payment, allocating a fresh reference and retrying on a reference
 * collision (the 8-char space is small enough that rare collisions happen). A
 * `23505` on `idempotency_key` is re-thrown as an `internal_error` carrying the
 * `23505` code so `withIdempotency` can resolve the race by re-reading the winner.
 */
async function insertPaymentWithReference(payload: NewPaymentPayload): Promise<Payment> {
  let lastCode: string | undefined;
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const { data, error } = await db()
      .from("payments")
      .insert({ ...payload, reference: generateReference() })
      .select()
      .single();
    if (!error) return data as unknown as Payment;
    const err = error as SupabaseLikeError;
    if (err.code === "23505" && uniqueViolationTarget(err) === "reference") {
      lastCode = err.code;
      continue;
    }
    throw internal("Failed to create payment", { code: err.code });
  }
  throw internal("Could not allocate a unique payment reference", { code: lastCode });
}

async function loadWallet(walletId: string | null): Promise<Wallet | null> {
  if (!walletId) return null;
  const { data, error } = await db()
    .from("wallets")
    .select("*")
    .eq("id", walletId)
    .maybeSingle();
  if (error) throw internal("Failed to load wallet", { code: error.code });
  return (data as unknown as Wallet | null) ?? null;
}

/** Load a plan, requiring it to belong to the merchant and be active. */
async function loadActivePlan(
  merchantId: string,
  planId: string,
): Promise<PricingPlan & { amount: number }> {
  const { data, error } = await db()
    .from("pricing_plans")
    .select("*")
    .eq("id", planId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw internal("Failed to load plan", { code: error.code });
  const plan = data as unknown as PricingPlan | null;
  if (!plan) throw notFound("Plan not found");
  if (plan.status !== "active") throw conflict("Plan is not active");
  if (plan.open_amount || plan.amount === null) {
    throw unprocessable(
      "Plan has no fixed amount; open-amount plans cannot create a payment",
    );
  }
  return plan as PricingPlan & { amount: number };
}

function encodeCursor(payment: Payment): string {
  return Buffer.from(
    JSON.stringify({ created_at: payment.created_at, id: payment.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { created_at?: unknown; id?: unknown };
    if (typeof parsed.created_at === "string" && typeof parsed.id === "string") {
      return { created_at: parsed.created_at, id: parsed.id };
    }
  } catch {
    /* malformed cursor — ignore (treated as no cursor) */
  }
  return null;
}

/**
 * Create a payment. Order of operations (SPEC §7): authenticate (done by caller) →
 * idempotency replay → load plan → assign wallet → allocate reference → snapshot →
 * `awaiting_payment`, 30-min TTL.
 */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const {
    merchant,
    planId,
    orderId,
    provider,
    callbackUrl,
    successUrl,
    cancelUrl,
    metadata,
    idempotencyKey,
    origin,
  } = input;

  const payment = await withIdempotency(merchant.id, idempotencyKey, async () => {
    const plan = await loadActivePlan(merchant.id, planId);
    const amount = plan.amount;

    const wallet = await assignWallet(provider, merchant.id);
    if (!wallet) {
      throw noWalletAvailable("No live wallet is currently available for this provider");
    }

    const id = newId(PRE.payment);
    const fee = computeFee(amount, merchant.fee_rate_bps);
    const net = computeNet(amount, merchant.fee_rate_bps);
    const planSnapshot: PlanSnapshot = {
      id: plan.id,
      name: plan.name,
      amount: plan.amount,
      currency: plan.currency,
      version: plan.version,
      open_amount: plan.open_amount,
      min_amount: plan.min_amount,
      max_amount: plan.max_amount,
    };

    return insertPaymentWithReference({
      id,
      merchant_id: merchant.id,
      plan_id: plan.id,
      plan_snapshot: planSnapshot,
      order_id: orderId,
      provider,
      wallet_id: wallet.id,
      offered_wallet_ids: [wallet.id],
      amount,
      fee_amount: fee,
      net_amount: net,
      status: "awaiting_payment",
      idempotency_key: idempotencyKey,
      callback_url: callbackUrl ?? null,
      success_url: successUrl ?? null,
      cancel_url: cancelUrl ?? null,
      metadata: metadata ?? null,
      expires_at: new Date(Date.now() + paymentTtlMs()).toISOString(),
    });
  });

  const wallet = await loadWallet(payment.wallet_id);
  const payUrl = new URL(`/pay/${payment.id}`, origin).toString();
  return { payment, wallet, payUrl };
}

/** List a merchant's payments with keyset pagination (`limit`, `cursor`). */
export async function listPayments(
  merchantId: string,
  filters: ListPaymentsFilters = {},
): Promise<ListPaymentsResult> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

  const base = db()
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("merchant_id", merchantId);
  let scoped = base;
  if (filters.status) scoped = scoped.eq("status", filters.status);
  if (filters.provider) scoped = scoped.eq("provider", filters.provider);

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  if (cursor) {
    scoped = scoped.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw internal("Failed to list payments", { code: error.code });

  const rows = (data as unknown as PaymentWithWallet[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}

/** Load one payment (with its receiving wallet) scoped to the merchant, or `404`. */
export async function getPayment(
  merchantId: string,
  paymentId: string,
): Promise<PaymentWithWallet> {
  const { data, error } = await db()
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("id", paymentId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw internal("Failed to load payment", { code: error.code });
  const payment = data as unknown as PaymentWithWallet | null;
  if (!payment) throw notFound("Payment not found");
  return payment;
}

/**
 * Cancel a payment. Only non-terminal payments can be cancelled; the update is
 * guarded by `status IN (created, awaiting_payment)` so a racing match cannot be
 * clobbered. Terminal states return `409 conflict`.
 */
export async function cancelPayment(
  merchantId: string,
  paymentId: string,
): Promise<PaymentWithWallet> {
  const existing = await getPayment(merchantId, paymentId);
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw conflict(`Payment is ${existing.status} and cannot be cancelled`);
  }

  const { data, error } = await db()
    .from("payments")
    .update({ status: "cancelled" })
    .eq("id", paymentId)
    .eq("merchant_id", merchantId)
    .in("status", OPEN_STATUSES)
    .select(PAYMENT_SELECT)
    .maybeSingle();
  if (error) throw internal("Failed to cancel payment", { code: error.code });
  const updated = data as unknown as PaymentWithWallet | null;
  if (!updated) throw conflict("Payment is no longer cancellable");
  return updated;
}

/**
 * Public hosted pay-page view (SPEC §7 `GET /v1/pay/:id`). Exposes only what the
 * customer needs — never merchant secrets (fee, net, metadata, callback_url).
 */
export async function getPayPage(paymentId: string): Promise<PayPageView> {
  const { data, error } = await db()
    .from("payments")
    .select(PAYMENT_SELECT)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw internal("Failed to load payment", { code: error.code });
  const payment = data as unknown as PaymentWithWallet | null;
  if (!payment) throw notFound("Payment not found");

  return {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    amount_bdt: formatBdt(payment.amount),
    provider: payment.provider,
    reference: payment.reference,
    wallet: toWalletView(payment.wallets ?? null),
    expires_at: payment.expires_at,
    trxid_required: PROVIDERS[payment.provider].referenceMode === "trxid_only",
    review_reason: payment.review_reason,
  };
}

/**
 * Persist the customer-supplied TrxID (SPEC §7 `POST /v1/pay/:id/submit-trx`),
 * used by the matching engine as the fallback rule. Only open payments accept one.
 */
export async function submitPaymentTrx(
  paymentId: string,
  trxId: string,
): Promise<{ ok: true; status: PaymentStatus }> {
  const { data: existing, error: loadError } = await db()
    .from("payments")
    .select("id, status")
    .eq("id", paymentId)
    .maybeSingle();
  if (loadError) throw internal("Failed to load payment", { code: loadError.code });
  if (!existing) throw notFound("Payment not found");

  const currentStatus = (existing as { status: PaymentStatus }).status;
  if (!OPEN_STATUSES.includes(currentStatus)) {
    throw conflict(`Payment is ${currentStatus} and no longer accepts a TrxID`);
  }

  const { data, error } = await db()
    .from("payments")
    .update({ submitted_trx_id: trxId })
    .eq("id", paymentId)
    .in("status", OPEN_STATUSES)
    .select("status")
    .single();
  if (error) throw internal("Failed to submit TrxID", { code: error.code });
  const updated = data as { status: PaymentStatus } | null;
  if (!updated) throw conflict("Payment is no longer open");
  return { ok: true, status: updated.status };
}
