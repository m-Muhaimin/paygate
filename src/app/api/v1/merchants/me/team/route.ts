/**
 * `/v1/merchants/me/team` — console alias of `/v1/team` (SPEC §7). Same handler
 * shape; the console calls this path.
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
