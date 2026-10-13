/**
 * `/v1/admin/payouts/:id/reject` — reject a requested payout (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { rejectPayout } from "@/lib/payouts/service";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";

const bodySchema = z
  .object({
    reason: z.string().max(1000).nullish(),
  })
  .strict();

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = parseOrThrow(bodySchema, await readJsonBody(req), "Invalid rejection payload");
    await rejectPayout({
      payoutId: id,
      actor: actorFromRequest(req),
      ip: clientIp(req),
      reason: body.reason ?? null,
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
