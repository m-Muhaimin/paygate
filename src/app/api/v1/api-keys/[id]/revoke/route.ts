/**
 * `/v1/api-keys/:id/revoke` — revoke a merchant API key (SPEC §7).
 *
 * Auth: merchant API key; scoped so a tenant can only revoke its own keys.
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { revokeApiKey } from "@/lib/settlements/api-keys";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;
    await revokeApiKey(merchant.id, id, actorFromRequest(req), clientIp(req));
    return new Response(null, { status: 204, headers: { "x-request-id": requestId } });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
