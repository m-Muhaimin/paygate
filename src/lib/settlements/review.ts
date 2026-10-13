/**
 * Admin review queue (SPEC §4, §7 `/v1/admin/review`).
 *
 * Two sources feed the queue:
 *   1. Unmatched incoming SMS (unknown/bad reference) — `incoming_txns` with a
 *      null `claimed_payment_id` and the `unmatched` flag.
 *   2. Payments parked in `needs_review` (amount mismatch, wrong wallet, late,
 *      duplicate ref, conflict).
 *
 * A check-char `suggestNearMatch` is surfaced for every case but is **never**
 * auto-applied (SPEC §4) — an operator decides.
 *
 * Because `incoming_txns` has no surrogate id (natural key
 * `(provider, trx_id, wallet_id)`), a case id is a URL-safe base64 of the key,
 * prefixed `itx:`; payment-parked cases use `pay:<payment.id>`.
 */

import { forbidden, internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { IncomingTxn, Payment, Provider, ReviewReason } from "@/lib/db/types";
import { suggestNearMatch } from "@/lib/domain/reference";
import { postPaymentPaid } from "@/lib/ledger/post";

export type ReviewAction = "match" | "dismiss" | "mark_paid";

/** The `ReviewCase` shape the admin console renders. */
export interface ReviewCaseDTO {
  id: string;
  reason: ReviewReason;
  created_at: string;
  payment: Payment | null;
  incoming: IncomingTxn | null;
  suggested_reference: string | null;
  candidates: Payment[];
}

interface IncomingKey {
  provider: Provider;
  trxId: string;
  walletId: string;
}

/** Encode an incoming-txn natural key into a review case id. */
export function encodeIncomingCaseId(key: IncomingKey): string {
  const raw = JSON.stringify([key.provider, key.trxId, key.walletId]);
  return `itx:${Buffer.from(raw, "utf8").toString("base64url")}`;
}

/** Decode an `itx:` review case id, or `null` when malformed. */
export function decodeIncomingCaseId(id: string): IncomingKey | null {
  if (!id.startsWith("itx:")) return null;
  try {
    const raw = Buffer.from(id.slice(4), "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [provider, trxId, walletId] = parsed;
    if (typeof provider !== "string" || typeof trxId !== "string" || typeof walletId !== "string") {
      return null;
    }
    return { provider: provider as Provider, trxId, walletId };
  } catch {
    return null;
  }
}

const PAYMENT_CASE_PREFIX = "pay:";

export function encodePaymentCaseId(paymentId: string): string {
  return `${PAYMENT_CASE_PREFIX}${paymentId}`;
}

export function decodePaymentCaseId(id: string): string | null {
  return id.startsWith(PAYMENT_CASE_PREFIX) ? id.slice(PAYMENT_CASE_PREFIX.length) : null;
}

const REVIEW_CASE_LIMIT = 100;
const CANDIDATE_LIMIT = 500;

function reasonOf(value: ReviewReason | null): ReviewReason {
  return value ?? "unmatched";
}

/** Build the admin review queue from both sources. */
export async function listReviewCases(): Promise<ReviewCaseDTO[]> {
  const { data: incomingRows, error: incomingError } = await db()
    .from("incoming_txns")
    .select("*")
    .is("claimed_payment_id", null)
    .contains("flags", ["unmatched"])
    .order("received_at", { ascending: false })
    .limit(REVIEW_CASE_LIMIT);
  if (incomingError) throw internal("Failed to load review queue", { code: incomingError.code });

  const { data: reviewRows, error: reviewError } = await db()
    .from("payments")
    .select("*")
    .eq("status", "needs_review")
    .order("created_at", { ascending: false })
    .limit(REVIEW_CASE_LIMIT);
  if (reviewError) throw internal("Failed to load review queue", { code: reviewError.code });

  const { data: candidateRows, error: candidateError } = await db()
    .from("payments")
    .select("*")
    .in("status", ["awaiting_payment", "needs_review"])
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  if (candidateError) throw internal("Failed to load review candidates", { code: candidateError.code });

  const incoming = (incomingRows as unknown as IncomingTxn[] | null) ?? [];
  const reviewPayments = (reviewRows as unknown as Payment[] | null) ?? [];
  const candidates = (candidateRows as unknown as Payment[] | null) ?? [];
  const candidateRefs = candidates.map((p) => p.reference);

  const claimedByPayment = new Map<string, IncomingTxn>();
  for (const row of incoming) {
    if (row.claimed_payment_id) claimedByPayment.set(row.claimed_payment_id, row);
  }

  const cases: ReviewCaseDTO[] = [];

  for (const row of incoming) {
    const suggested = suggestNearMatch(row.ref_normalized ?? "", candidateRefs);
    const payment = suggested ? candidates.find((p) => p.reference === suggested) ?? null : null;
    cases.push({
      id: encodeIncomingCaseId({
        provider: row.provider,
        trxId: row.trx_id,
        walletId: row.wallet_id,
      }),
      reason: "unmatched",
      created_at: row.received_at,
      payment,
      incoming: row,
      suggested_reference: suggested,
      candidates,
    });
  }

  for (const payment of reviewPayments) {
    const linked = claimedByPayment.get(payment.id) ?? null;
    const suggested = linked
      ? suggestNearMatch(linked.ref_normalized ?? "", candidateRefs)
      : null;
    cases.push({
      id: encodePaymentCaseId(payment.id),
      reason: reasonOf(payment.review_reason),
      created_at: payment.created_at,
      payment,
      incoming: linked,
      suggested_reference: suggested,
      candidates: candidates.filter((p) => p.id !== payment.id),
    });
  }

  return cases;
}

export interface ResolveReviewArgs {
  caseId: string;
  action: ReviewAction;
  paymentId?: string | null;
  note?: string | null;
  actor: string;
  ip?: string | null;
}

async function loadPayment(paymentId: string): Promise<Payment> {
  const { data, error } = await db()
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw internal("Failed to load payment", { code: error.code });
  const payment = data as unknown as Payment | null;
  if (!payment) throw notFound("Payment not found");
  return payment;
}

async function claimIncoming(paymentId: string, key: IncomingKey): Promise<void> {
  const { error } = await db()
    .from("incoming_txns")
    .update({ claimed_payment_id: paymentId })
    .eq("provider", key.provider)
    .eq("trx_id", key.trxId)
    .eq("wallet_id", key.walletId)
    .is("claimed_payment_id", null);
  if (error) throw internal("Failed to claim incoming transaction", { code: error.code });
}

/**
 * Resolve one review case.
 *   `match`     — bind the incoming txn to `payment_id` and mark it paid
 *   `mark_paid` — mark the case's payment paid
 *   `dismiss`   — record the decision, change nothing
 *
 * Money: `match`/`mark_paid` post the balanced paid-ledger entry once, via the
 * shared ledger module (skip when the payment is already `paid`).
 */
export async function resolveReview(args: ResolveReviewArgs): Promise<Payment | null> {
  const paymentCaseId = decodePaymentCaseId(args.caseId);
  const incomingKey = decodeIncomingCaseId(args.caseId);
  if (!paymentCaseId && !incomingKey) throw notFound("Review case not found");

  if (args.action === "dismiss") {
    return null;
  }

  const paymentId = args.action === "match" ? args.paymentId : args.paymentId ?? paymentCaseId;
  if (!paymentId) {
    throw forbidden("A payment_id is required to resolve this case");
  }

  const payment = await loadPayment(paymentId);

  if (incomingKey) await claimIncoming(payment.id, incomingKey);

  if (payment.status === "paid") return payment;

  const { data, error } = await db()
    .from("payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      matched_by: payment.matched_by ?? "reference",
    })
    .eq("id", payment.id)
    .select()
    .single();
  if (error) throw internal("Failed to update payment", { code: error.code });
  const updated = data as unknown as Payment;

  // Non-atomic with the status update (supabase-js has no client transaction);
  // the ledger post is idempotent-by-status (skipped when already paid).
  await postPaymentPaid(updated);

  return updated;
}
