/**
 * `/v1/admin/devices/:id/flush` — flush a device's pending queue (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { requireAdmin } from "@/lib/settlements/admin";
import { flushDevice } from "@/lib/settlements/devices";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    await flushDevice(id, actorFromRequest(req), clientIp(req));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
