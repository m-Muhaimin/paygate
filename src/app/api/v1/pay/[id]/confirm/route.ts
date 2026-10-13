/**
 * `POST /v1/pay/:id/confirm` — customer confirms a transfer (SPEC v3.1 §B).
 *
 * Unauthenticated, 10/min/IP. The customer submits the SMS TrxID; we persist it,
 * move `awaiting_payment → confirming`, look for the matching incoming SMS, and —
 * when there is none yet — hold and poll for up to 90s before answering
 * `{ status: "confirming" }` (SPEC §B.5/§B.6). Five attempts lock the payment for
 * 15 minutes (`429 too_many_attempts`).
 *
 * Realtime: a best-effort broadcast on channel `payment:<id>` is fired after each
 * state change so the pay page can react without polling. Failures are ignored.
 */

import { z } from "zod";

import { ApiError, notFound } from "@/lib/api/errors";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/ratelimit";
import { db } from "@/lib/db/client";
import { matchPayment, type MatchPaymentResult, type MatchPaymentStatus } from "@/lib/matching/engine";
import { getPayPage } from "@/lib/services/payments";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import type { MatchedBy, ReviewReason } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const TRX_ID_RE = /^[A-Za-z0-9]{6,24}$/;

const TERMINAL_STATUSES = new Set(["paid", "expired", "cancelled", "needs_review"]);

const confirmSchema = z
  .object({
    trx_id: z
      .string()
      .trim()
      .regex(TRX_ID_RE, "TrxID must be 6-24 alphanumeric characters"),
  })
  .strict();

/** The v3.1 columns this route reads (not yet in the canonical `Payment` type). */
interface ConfirmCore {
  id: string;
  status: string;
  reference: string;
  submitted_trx_id: string | null;
  matched_by: MatchedBy | null;
  review_reason: ReviewReason | null;
  confirm_attempts: number | null;
  locked_until: string | null;
}

/** Hold window for the confirm poll (SPEC §B.6), tests may shorten via env. */
function holdMs(): number {
  const raw = Number(process.env.PAY_CONFIRM_HOLD_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 90_000;
}

/** Poll interval while holding, tests may shorten via env. */
function pollMs(): number {
  const raw = Number(process.env.PAY_CONFIRM_POLL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 1_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tooManyAttempts(retryAfterSec: number): ApiError {
  return new ApiError("too_many_attempts", 429, "Too many confirm attempts; try again later", {
    retry_after: retryAfterSec,
  });
}

function isLocked(core: ConfirmCore): boolean {
  return core.locked_until !== null && new Date(core.locked_until).getTime() > Date.now();
}

async function loadPayment(id: string): Promise<ConfirmCore | null> {
  const { data } = await db()
    .from("payments")
    .select(
      "id,status,reference,submitted_trx_id,matched_by,review_reason,confirm_attempts,locked_until",
    )
    .eq("id", id)
    .maybeSingle();
  return (data as ConfirmCore | null) ?? null;
}

/** Best-effort Realtime broadcast on `payment:<id>`; never throws. */
function broadcast(paymentId: string): void {
  try {
    const client = db() as unknown as {
      channel?: (name: string) => { send: (msg: unknown) => Promise<unknown> };
    };
    if (typeof client.channel !== "function") return;
    const channel = client.channel(`payment:${paymentId}`);
    void channel
      .send({ type: "broadcast", event: "payment", payload: { payment_id: paymentId } })
      .catch(() => {});
  } catch {
    // Realtime is an optimisation; the page still polls.
  }
}

/** Build the canonical confirm response: `{ status, matched_by?, review_reason?, payment }`. */
async function respond(
  id: string,
  status: MatchPaymentStatus,
  matchedBy?: MatchedBy | null,
  reviewReason?: ReviewReason | null,
): Promise<Response> {
  let payment: unknown = null;
  try {
    payment = await getPayPage(id);
  } catch {
    payment = null;
  }
  const body: Record<string, unknown> = { status };
  if (matchedBy) body.matched_by = matchedBy;
  if (reviewReason) body.review_reason = reviewReason;
  body.payment = payment;
  return json(body, { status: 200 });
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    enforceRateLimit(req, "pay-confirm", 10, 60);
    const { id } = await ctx.params;

    const payment = await loadPayment(id);
    if (!payment) throw notFound("Payment not found");

    // Idempotent: a terminal payment is returned as-is, no new attempt recorded.
    if (TERMINAL_STATUSES.has(payment.status)) {
      return respond(id, payment.status as MatchPaymentStatus, payment.matched_by, payment.review_reason);
    }

    if (isLocked(payment)) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(payment.locked_until as string).getTime() - Date.now()) / 1000),
      );
      throw tooManyAttempts(retryAfter);
    }

    const attempts = payment.confirm_attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      // Defensive: a row locked by count but missing `locked_until`.
      await db()
        .from("payments")
        .update({ locked_until: new Date(Date.now() + LOCKOUT_MS).toISOString() })
        .eq("id", id);
      throw tooManyAttempts(Math.ceil(LOCKOUT_MS / 1000));
    }

    const { trx_id } = parseOrThrow(
      confirmSchema,
      await readJsonBody(req),
      "Invalid payload",
    );
    const trxId = trx_id.toUpperCase();
    const nextAttempts = attempts + 1;

    const patch: Record<string, unknown> = {
      submitted_trx_id: trxId,
      confirm_attempts: nextAttempts,
    };
    if (nextAttempts >= MAX_ATTEMPTS) {
      patch.locked_until = new Date(Date.now() + LOCKOUT_MS).toISOString();
    }
    // First acceptance moves the payment into `confirming`; `confirmed_at` records
    // when the customer accepted the transfer (SPEC v3.1 §A). Later confirms while
    // already `confirming` must not overwrite it.
    if (payment.status === "awaiting_payment") {
      patch.status = "confirming";
      patch.confirmed_at = new Date().toISOString();
    }

    await db().from("payments").update(patch).eq("id", id);
    broadcast(id);

    // Immediate match (the SMS may already be stored).
    let result: MatchPaymentResult = await matchPayment(id, { trxId });
    if (result.status !== "confirming" && result.status !== "awaiting_payment") {
      broadcast(id);
      return respond(id, result.status, result.matched_by, result.review_reason);
    }

    // Hold and poll for a status change (SPEC §B.6).
    const deadline = Date.now() + holdMs();
    while (Date.now() < deadline) {
      await sleep(Math.min(pollMs(), Math.max(1, deadline - Date.now())));
      result = await matchPayment(id, { trxId });
      if (result.status !== "confirming" && result.status !== "awaiting_payment") break;
    }

    broadcast(id);
    return respond(id, result.status, result.matched_by, result.review_reason);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
