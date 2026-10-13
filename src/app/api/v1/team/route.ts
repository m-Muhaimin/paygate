/**
 * `/v1/team` — list merchant team members (SPEC §7).
 *
 * Auth: merchant API key.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { listTeamMembers } from "@/lib/settlements/team";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    return json({ data: await listTeamMembers(merchant.id) });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
