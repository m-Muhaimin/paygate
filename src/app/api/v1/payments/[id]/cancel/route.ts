/**
 * `/v1/payments/:id/cancel` — cancel a non-terminal payment (SPEC §7).
 * Auth: merchant API key. Emits a `payment.cancelled` webhook (best-effort).
 */

import { errorResponse, getRequestId, json, logStructured } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { cancelPayment } from "@/lib/services/payments";
import { serializePayment } from "@/lib/services/serializers";
import { dispatchPaymentEvent } from "@/lib/services/webhooks";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;
    const payment = await cancelPayment(merchant.id, id);

    try {
      await dispatchPaymentEvent(merchant.id, "payment.cancelled", payment);
    } catch (err) {
      logStructured("warn", "webhook_dispatch_failed", {
        request_id: requestId,
        payment_id: payment.id,
        event: "payment.cancelled",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return json(serializePayment(payment), { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
