/**
 * `/v1/admin/payouts/:id/approve` — approve a payout (two-person rule) (SPEC §0, §7).
 *
 * Gate: `requireAdmin`. The approver must differ from the requester.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { approvePayout } from "@/lib/payouts/service";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";

const bodySchema = z
  .object({
    note: z.string().max(1000).nullish(),
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
    const body = parseOrThrow(bodySchema, await readJsonBody(req), "Invalid approval payload");
    await approvePayout({
      payoutId: id,
      actor: actorFromRequest(req),
      ip: clientIp(req),
      note: body.note ?? null,
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
