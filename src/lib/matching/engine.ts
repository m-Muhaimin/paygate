/**
 * Matching engine (SPEC §4).
 *
 * Given a freshly ingested incoming txn, decide its fate in exactly one atomic
 * step. Rule 1 (reference) is tried first, then rule 2 (TrxID fallback); either
 * the winning candidate is *claimed atomically* (`claim_incoming_txn`) or the txn
 * is left in the unmatched pool. Every ambiguous case becomes `needs_review` with
 * a specific `review_reason` — the engine never guesses.
 *
 * Side effects on a successful match: mark the payment `paid`/`matched_by`/
 * `paid_at`, post the double-entry ledger, then fire `payment.paid`. On a review
 * outcome the payment is moved to `needs_review` and `payment.needs_review` fires
 * (when a specific payment was identified).
 */

import { db } from "@/lib/db/client";
import { claimIncomingTxn } from "@/lib/db/rpc";
import { postPaymentPaid } from "@/lib/ledger/post";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { internal, notFound } from "@/lib/api/errors";
import type {
  IncomingTxn,
  MatchedBy,
  Payment,
  PaymentStatus,
  Provider,
  ReviewReason,
} from "@/lib/db/types";

export interface MatchInput {
  provider: Provider;
  trx_id: string;
  wallet_id: string;
  amount: number;
  balance_after: number | null;
  ref_normalized: string | null;
  parser_version?: string;
}

export type MatchOutcome = "paid" | "needs_review" | "unmatched" | "duplicate";

export interface MatchResult {
  outcome: MatchOutcome;
  paymentId?: string;
  matchedBy?: MatchedBy;
  reviewReason?: ReviewReason;
}

/** Payment statuses returned by the v3.1 confirm flow (`confirming` is v3.1-only). */
export type MatchPaymentStatus = PaymentStatus | "confirming";

export interface MatchPaymentOptions {
  /** Customer's TrxID claim; defaults to the persisted `submitted_trx_id`. */
  trxId?: string | null;
}

export interface MatchPaymentResult {
  status: MatchPaymentStatus;
  matched_by?: MatchedBy;
  review_reason?: ReviewReason;
}

/** Statuses that already represent a final outcome for a payment. */
const RESOLVED_STATUSES = new Set<PaymentStatus>(["paid", "expired", "cancelled", "needs_review"]);

/**
 * Evidence window for the v3.1 confirm flow (SPEC_v3_1 §B.6). A candidate SMS is
 * accepted when it arrived within 15 minutes of the payment being created (the
 * common case) *or* within 15 minutes of the confirm check — the latter covers a
 * phone that was offline and forwards the SMS on reconnect. All matching still
 * requires the SMS to post-date the payment (minus a small clock-skew allowance);
 * genuinely late payments are flagged `late_payment` by `tryClaim`.
 */
const SMS_WINDOW_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 60_000;

/**
 * SPEC_v3_1 §C — whether this merchant auto-confirms a reference+amount match.
 * Fails closed: only an explicit `merchants.auto_confirm = true` row enables
 * auto-settle. Any lookup error or missing/absent value returns `false`, so a
 * transient DB failure can never settle a payment without the customer's Confirm.
 */
async function merchantAutoConfirm(merchantId: string): Promise<boolean> {
  try {
    const { data, error } = await db()
      .from("merchants")
      .select("auto_confirm")
      .eq("id", merchantId)
      .maybeSingle();
    if (error) return false;
    const flag = (data as { auto_confirm?: boolean | null } | null)?.auto_confirm;
    return flag === true;
  } catch {
    return false;
  }
}

function withinConfirmWindow(
  receivedAt: string | null,
  payment: Payment,
  now = Date.now(),
): boolean {
  if (!receivedAt) return true;
  const t = new Date(receivedAt).getTime();
  if (Number.isNaN(t)) return true;
  const createdMs = payment.created_at ? new Date(payment.created_at).getTime() : null;
  const hasCreated = createdMs !== null && !Number.isNaN(createdMs);
  if (hasCreated && t < createdMs - CLOCK_SKEW_MS) return false;
  if (t > now + CLOCK_SKEW_MS) return false;
  const nearCreation = hasCreated && t <= createdMs + SMS_WINDOW_MS;
  const nearNow = now - t <= SMS_WINDOW_MS;
  return nearCreation || nearNow;
}

/** Load stored SMS that could prove this payment: exact TrxID first, then reference. */
async function loadCandidateTxns(payment: Payment, trxId: string | null): Promise<IncomingTxn[]> {
  const found = new Map<string, IncomingTxn>();
  const supabase = db();
  const add = (rows: IncomingTxn[] | null) => {
    for (const r of rows ?? []) found.set(`${r.provider}|${r.trx_id}|${r.wallet_id}`, r);
  };

  if (trxId) {
    const { data } = await supabase
      .from("incoming_txns")
      .select("*")
      .eq("provider", payment.provider)
      .eq("trx_id", trxId);
    add(data as IncomingTxn[] | null);
  }
  if (payment.reference) {
    const { data } = await supabase
      .from("incoming_txns")
      .select("*")
      .eq("ref_normalized", payment.reference);
    add(data as IncomingTxn[] | null);
  }
  return [...found.values()];
}

/**
 * Payment → evidence matcher (SPEC_v3_1 §B / PRD matching rules).
 *
 * Given a payment and the customer's TrxID claim, look for a stored incoming SMS
 * that proves it and apply the same guards as `matchIncomingTxn` (wallet, amount,
 * expiry, single-use claim). Returns the resulting payment status; when no evidence
 * is present yet it returns the current status (`confirming`/`awaiting_payment`)
 * so the caller can hold and poll.
 */
export async function matchPayment(
  paymentId: string,
  opts: MatchPaymentOptions = {},
): Promise<MatchPaymentResult> {
  const { data, error } = await db().from("payments").select("*").eq("id", paymentId).maybeSingle();
  if (error) throw internal("payment_load_failed", { code: error.code });
  const payment = data as Payment | null;
  if (!payment) throw notFound("Payment not found");

  if (RESOLVED_STATUSES.has(payment.status)) {
    return {
      status: payment.status,
      matched_by: payment.matched_by ?? undefined,
      review_reason: payment.review_reason ?? undefined,
    };
  }

  const trxId = (opts.trxId ?? payment.submitted_trx_id)?.toUpperCase() ?? null;
  const candidates = await loadCandidateTxns(payment, trxId);
  const now = Date.now();
  let pendingReview: MatchPaymentResult | null = null;

  for (const cand of candidates) {
    if (!withinConfirmWindow(cand.received_at, payment, now)) continue;

    // An SMS reference, when present, must equal this payment's reference.
    if (cand.ref_normalized && cand.ref_normalized !== payment.reference) {
      const res = await review(payment, "conflict");
      return { status: "needs_review", review_reason: res.reviewReason };
    }

    const matchedBy: MatchedBy = trxId && cand.trx_id === trxId ? "trxid" : "reference";
    const txn: MatchInput = {
      provider: cand.provider,
      trx_id: cand.trx_id,
      wallet_id: cand.wallet_id,
      amount: cand.amount,
      balance_after: cand.balance_after,
      ref_normalized: cand.ref_normalized,
    };
    const res = await tryClaim(payment, matchedBy, txn);
    if (res.outcome === "paid") return { status: "paid", matched_by: res.matchedBy };
    if (res.outcome === "needs_review" && !pendingReview) {
      pendingReview = { status: "needs_review", review_reason: res.reviewReason };
    }
  }

  if (pendingReview) return pendingReview;
  return { status: payment.status };
}

/**
 * Balance continuity (SPEC §9): the wallet balance before this credit should be
 * `balance_after − amount`. A mismatch means the SMS stream dropped a message
 * (or the amount is wrong) → flag `balance_gap`.
 */
export function balanceContinuityBroken(
  prevBalanceAfter: number | null,
  balanceAfter: number | null,
  amount: number,
): boolean {
  if (prevBalanceAfter === null || balanceAfter === null) return false;
  return balanceAfter - amount !== prevBalanceAfter;
}

type Conflict = "conflict";
type Pick = Payment | null | Conflict;

/** Collapse a candidate list: 0 → null, 1 → the row, >1 → conflict. */
function pickSingle(payments: Payment[]): Pick {
  const live = payments.filter((p) => p.status !== "cancelled");
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  return "conflict";
}

async function loadPayments(column: "reference" | "submitted_trx_id", value: string): Promise<Payment[]> {
  const { data, error } = await db().from("payments").select("*").eq(column, value);
  if (error) throw error;
  return (data ?? []) as Payment[];
}

async function flagBalanceGap(txn: MatchInput): Promise<void> {
  if (txn.balance_after === null) return;
  const { data } = await db()
    .from("incoming_txns")
    .select("trx_id,balance_after,flags")
    .eq("wallet_id", txn.wallet_id)
    .order("created_at", { ascending: false })
    .limit(5);

  type Row = { trx_id: string; balance_after: number | null; flags: string[] | null };
  const rows = (data ?? []) as Row[];
  const current = rows.find((r) => r.trx_id === txn.trx_id);
  const prev = rows.find(
    (r) => r.trx_id !== txn.trx_id && typeof r.balance_after === "number",
  );
  if (!prev) return;
  if (!balanceContinuityBroken(prev.balance_after, txn.balance_after, txn.amount)) return;

  const flags = new Set<string>(current?.flags ?? []);
  flags.add("balance_gap");
  await db()
    .from("incoming_txns")
    .update({ flags: [...flags] })
    .match({ provider: txn.provider, trx_id: txn.trx_id, wallet_id: txn.wallet_id });
}

async function review(payment: Payment, reason: ReviewReason): Promise<MatchResult> {
  const updated: Payment = { ...payment, status: "needs_review", review_reason: reason };
  await db().from("payments").update({ status: "needs_review", review_reason: reason }).eq("id", payment.id);
  try {
    await dispatchEvent(payment.merchant_id, "payment.needs_review", updated);
  } catch {
    // A webhook failure must not undo a review decision.
  }
  return { outcome: "needs_review", paymentId: payment.id, reviewReason: reason };
}

async function tryClaim(
  payment: Payment,
  matchedBy: MatchedBy,
  txn: MatchInput,
): Promise<MatchResult> {
  // Wallet must be one the payment offered (SPEC §4).
  const offered = payment.offered_wallet_ids ?? [];
  const walletOk = payment.wallet_id === txn.wallet_id || offered.includes(txn.wallet_id);
  if (!walletOk) return review(payment, "wrong_wallet");

  // Expired payment that received money late.
  const expiredByStatus = payment.status === "expired";
  const expiredByTime =
    payment.expires_at !== null && Date.now() > new Date(payment.expires_at).getTime();
  if (expiredByStatus || expiredByTime) return review(payment, "late_payment");

  // Exact amount required.
  if (txn.amount < payment.amount) return review(payment, "underpaid");
  if (txn.amount > payment.amount) return review(payment, "overpaid");

  // Atomic single-use claim — only one caller wins the race.
  const claimed = await claimIncomingTxn({
    provider: txn.provider,
    trxId: txn.trx_id,
    walletId: txn.wallet_id,
    paymentId: payment.id,
  });
  if (!claimed) return review(payment, "duplicate_ref");

  const paidAt = new Date().toISOString();
  await db()
    .from("payments")
    .update({ status: "paid", matched_by: matchedBy, paid_at: paidAt })
    .eq("id", payment.id);

  const updated: Payment = {
    ...payment,
    status: "paid",
    matched_by: matchedBy,
    paid_at: paidAt,
  };

  try {
    await postPaymentPaid(updated);
    await dispatchEvent(payment.merchant_id, "payment.paid", updated);
  } catch {
    // Ledger/webhook failures are retried elsewhere; the claim already stands.
  }

  return { outcome: "paid", paymentId: payment.id, matchedBy };
}

/**
 * Match one incoming txn. Returns the outcome for the caller/tests; all state
 * changes are applied as side effects.
 */
export async function matchIncomingTxn(txn: MatchInput): Promise<MatchResult> {
  try {
    await flagBalanceGap(txn);
  } catch {
    // Continuity flagging is best-effort and never blocks matching.
  }

  const refMatches = txn.ref_normalized ? await loadPayments("reference", txn.ref_normalized) : [];
  const trxMatches = await loadPayments("submitted_trx_id", txn.trx_id);

  // duplicate_ref: the reference was already claimed by a paid payment.
  if (txn.ref_normalized) {
    const alreadyPaid = refMatches.find((p) => p.status === "paid");
    if (alreadyPaid) return review(alreadyPaid, "duplicate_ref");
  }

  const refPick = pickSingle(refMatches);
  const trxPick = pickSingle(trxMatches);

  // Rule 1: reference.
  if (refPick === "conflict") return review(refMatches[0], "conflict");
  if (refPick) {
    // ref + trxid point at different payments → conflict.
    if (trxPick && trxPick !== "conflict" && trxPick.id !== refPick.id) {
      return review(refPick, "conflict");
    }
    // A matching submitted TrxID is a confirmed claim → always settle.
    const confirmed =
      refPick.submitted_trx_id !== null && refPick.submitted_trx_id === txn.trx_id;
    if (confirmed) return tryClaim(refPick, "trxid", txn);
    // The reference alone only auto-settles when the merchant allows it
    // (SPEC_v3_1 §C); with auto-confirm off the SMS waits as unclaimed evidence.
    if (await merchantAutoConfirm(refPick.merchant_id)) return tryClaim(refPick, "reference", txn);
    return { outcome: "unmatched" };
  }

  // Rule 2: TrxID fallback.
  if (trxPick === "conflict") return review(trxMatches[0], "conflict");
  if (trxPick) return tryClaim(trxPick, "trxid", txn);

  // Nothing to match — leaves the txn in the unmatched pool for an operator.
  return { outcome: "unmatched" };
}
