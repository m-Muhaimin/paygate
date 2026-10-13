/**
 * Outbound merchant-webhook dispatch seam (SPEC §8).
 *
 * The dispatcher itself lives in `@/lib/webhooks/dispatch` (built in parallel).
 * The import is lazy so this module loads and type-checks before that file lands,
 * and so a dispatch failure can never break an already-committed state change.
 * Signature is fixed by the contract:
 *   `dispatchEvent(merchantId, eventType, payment)`.
 */

import type { Payment } from "@/lib/db/types";

export type PaymentEventType =
  | "payment.paid"
  | "payment.expired"
  | "payment.needs_review"
  | "payment.cancelled";

export async function dispatchPaymentEvent(
  merchantId: string,
  type: PaymentEventType,
  payment: Payment,
): Promise<void> {
  const { dispatchEvent } = await import("@/lib/webhooks/dispatch");
  await dispatchEvent(merchantId, type, payment);
}
