/**
 * POST /v1/webhooks/:id/resend — merchant-key manual resend of a webhook delivery
 * (SPEC §8). Deliberately small: authenticate, scope to the merchant, re-run one
 * delivery attempt.
 */

import { db } from "@/lib/db/client";
import { json, getRequestId, errorResponse } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { attemptDelivery } from "@/lib/webhooks/dispatch";
import { notFound } from "@/lib/api/errors";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { id } = await ctx.params;
    const { merchant } = await authenticateMerchant(req);

    const { data: delivery } = await db()
      .from("webhook_deliveries")
      .select("id,merchant_id")
      .eq("id", id)
      .maybeSingle();

    if (!delivery || (delivery as { merchant_id: string }).merchant_id !== merchant.id) {
      throw notFound("delivery_not_found");
    }

    await attemptDelivery(id);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
