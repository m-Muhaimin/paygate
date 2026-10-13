/**
 * `/v1/pay/:id/submit-trx` — customer submits the SMS TrxID (SPEC §7).
 *
 * Unauthenticated: used by the hosted pay page as the matching fallback. Rate
 * limited 10/min/IP.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/ratelimit";
import { submitPaymentTrx, submitTrxSchema } from "@/lib/services/payments";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    enforceRateLimit(req, "pay-submit-trx", 10, 60);
    const { id } = await ctx.params;
    const { trx_id } = parseOrThrow(submitTrxSchema, await readJsonBody(req), "Invalid payload");
    const result = await submitPaymentTrx(id, trx_id);
    return json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
