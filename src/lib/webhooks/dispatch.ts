/**
 * Outbound webhook dispatch + delivery (SPEC §8).
 *
 * `dispatchEvent` records a `webhook_deliveries` row (with the exact SPEC §8
 * payload shape) and immediately attempts the first delivery. `attemptDelivery`
 * performs one HTTP POST with a signed `PayGate-Signature` header and, on
 * failure, parks the row on the exponential retry schedule.
 */

import { db } from "@/lib/db/client";
import type { Payment } from "@/lib/db/types";
import { buildSignatureHeader } from "@/lib/api/crypto";
import { internal } from "@/lib/api/errors";
import { newId } from "@/lib/domain/ids";

export type WebhookEventType =
  | "payment.paid"
  | "payment.expired"
  | "payment.needs_review"
  | "payment.cancelled";

/** SPEC §8 payload envelope. */
export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  reference: string;
  plan_id: string | null;
  matched_by: Payment["matched_by"];
  net_amount: number;
  settlement_status: string;
  payment: Payment;
}

/** Retry delays in seconds (SPEC §8): 10s,1m,5m,30m,2h,6h,24h → then `failed`. */
export const RETRY_SCHEDULE_SECONDS = [10, 60, 300, 1800, 7200, 21600, 86400];

/** Delay (seconds) after the Nth failed attempt, or null when exhausted. */
export function nextRetryDelaySeconds(attempts: number): number | null {
  const idx = attempts - 1;
  return idx >= 0 && idx < RETRY_SCHEDULE_SECONDS.length ? RETRY_SCHEDULE_SECONDS[idx] : null;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Webhook signing secret for a merchant.
 *
 * NOTE: the schema stores `webhook_secret_hash`. Treating it as the signing
 * material is a deliberate stop-gap (see report deviations) — a hash is one-way,
 * so a true rotating plaintext secret would need a schema change.
 */
async function getWebhookSecret(merchantId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("merchants")
    .select("webhook_secret_hash")
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw internal("webhook_secret_lookup_failed", { code: error.code });
  return (data?.webhook_secret_hash as string | null) ?? null;
}

/**
 * Create a delivery row for `type` and try it once.
 *
 * A payment with no `callback_url` produces a `failed` row with no attempt (there
 * is nowhere to deliver); callers should not assume a network call happened.
 */
export async function dispatchEvent(
  merchantId: string,
  type: WebhookEventType,
  payment: Payment,
): Promise<void> {
  const eventId = newId("evt_");
  const payload: WebhookPayload = {
    event_id: eventId,
    type,
    reference: payment.reference,
    plan_id: payment.plan_id,
    matched_by: payment.matched_by,
    net_amount: payment.net_amount,
    settlement_status: "pending",
    payment,
  };

  const url = payment.callback_url ?? "";
  const { data: delivery, error } = await db()
    .from("webhook_deliveries")
    .insert({
      id: newId("whd_"),
      merchant_id: merchantId,
      payment_id: payment.id,
      event_type: type,
      event_id: eventId,
      url,
      payload,
      status: "pending",
      attempts: 0,
      next_attempt_at: null,
      last_status_code: null,
    })
    .select("id")
    .single();

  if (error) throw internal("webhook_create_failed", { code: error.code });
  const deliveryId = (delivery as { id: string } | null)?.id;
  if (!deliveryId) throw internal("webhook_create_failed");

  // No URL configured → nothing to deliver to; leave it `failed` for the operator.
  if (!url) {
    await db().from("webhook_deliveries").update({ status: "failed" }).eq("id", deliveryId);
    return;
  }

  await attemptDelivery(deliveryId);
}

/**
 * Perform one delivery attempt for an existing `webhook_deliveries` row.
 *
 * Success → `success`. Failure → `pending` with `next_attempt_at` from the
 * schedule, or `failed` once the schedule is exhausted (manual resend available).
 */
export async function attemptDelivery(deliveryId: string): Promise<void> {
  const { data: delivery, error } = await db()
    .from("webhook_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .maybeSingle();

  if (error) throw internal("webhook_load_failed", { code: error.code });
  if (!delivery) throw internal("webhook_delivery_not_found");

  const row = delivery as {
    id: string;
    merchant_id: string;
    url: string;
    payload: unknown;
    attempts: number | null;
    event_type: string;
  };
  const attempts = (row.attempts ?? 0) + 1;

  const secret = await getWebhookSecret(row.merchant_id);
  if (!secret) {
    // Cannot sign → do not send an unsigned webhook. Mark terminally failed.
    await db()
      .from("webhook_deliveries")
      .update({ status: "failed", attempts, next_attempt_at: null })
      .eq("id", deliveryId);
    return;
  }

  const rawBody = JSON.stringify(row.payload ?? {});
  const signature = await buildSignatureHeader(secret, rawBody);

  let statusCode: number | null = null;
  let ok = false;
  try {
    const res = await fetch(row.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "PayGate-Signature": signature },
      body: rawBody,
    });
    statusCode = res.status;
    ok = isSuccess(res.status);
  } catch {
    statusCode = null;
    ok = false;
  }

  if (ok) {
    await db()
      .from("webhook_deliveries")
      .update({ status: "success", attempts, last_status_code: statusCode, next_attempt_at: null })
      .eq("id", deliveryId);
    return;
  }

  const delay = nextRetryDelaySeconds(attempts);
  await db()
    .from("webhook_deliveries")
    .update({
      status: delay === null ? "failed" : "pending",
      attempts,
      last_status_code: statusCode,
      next_attempt_at: delay === null ? null : new Date(Date.now() + delay * 1000).toISOString(),
    })
    .eq("id", deliveryId);
}
