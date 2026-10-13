/**
 * `/v1/merchants/me/webhook-secret/rotate` — console alias of
 * `/v1/webhooks/secret/rotate` (SPEC §7). Both paths share the same handler.
 *
 * Auth: merchant API key.
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { rotateWebhookSecret } from "@/lib/settlements/webhook-secret";

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const result = await rotateWebhookSecret(merchant, actorFromRequest(req), clientIp(req));
    return json(result);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
