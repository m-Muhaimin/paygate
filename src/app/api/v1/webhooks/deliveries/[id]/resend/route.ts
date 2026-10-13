/**
 * `/v1/webhooks/deliveries/:id/resend` — manually re-attempt a delivery (SPEC §7).
 *
 * Auth: merchant API key; the delivery must belong to the caller's merchant
 * before we re-attempt it.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { internal, notFound } from "@/lib/api/errors";
import { authenticateMerchant } from "@/lib/api/tenant";
import { db } from "@/lib/db/client";
import { manualResend } from "@/lib/webhooks/inspector";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;

    const { data, error } = await db()
      .from("webhook_deliveries")
      .select("id")
      .eq("id", id)
      .eq("merchant_id", merchant.id)
      .maybeSingle();
    if (error) throw internal("Failed to load webhook delivery", { code: error.code });
    if (!data) throw notFound("Webhook delivery not found");

    await manualResend(id);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
