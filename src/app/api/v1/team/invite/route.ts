/**
 * `/v1/team/invite` — invite a merchant team member (SPEC §7).
 *
 * Auth: merchant API key. See `@/lib/settlements/team` for the Auth-invite TODO.
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { inviteTeamMember, teamInviteSchema } from "@/lib/settlements/team";

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const body = parseOrThrow(
      teamInviteSchema,
      await readJsonBody(req),
      "Invalid invitation payload",
    );
    const member = await inviteTeamMember({
      merchantId: merchant.id,
      email: body.email,
      role: body.role ?? "staff",
      actor: actorFromRequest(req),
      ip: clientIp(req),
    });
    return json(member, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
