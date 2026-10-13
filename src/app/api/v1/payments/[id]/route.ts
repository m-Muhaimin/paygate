/**
 * `/v1/payments/:id` — read a single payment (SPEC §7). Auth: merchant API key.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { getPayment } from "@/lib/services/payments";
import { serializePayment } from "@/lib/services/serializers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;
    const payment = await getPayment(merchant.id, id);
    return json(serializePayment(payment), { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
