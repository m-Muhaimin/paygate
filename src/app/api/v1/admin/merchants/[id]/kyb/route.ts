/**
 * `/v1/admin/merchants/:id/kyb` — record a KYB decision (SPEC §7, §9).
 *
 * Gate: `requireAdmin`.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import { decideKyb } from "@/lib/settlements/merchants";

const bodySchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
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
    const body = parseOrThrow(bodySchema, await readJsonBody(req), "Invalid KYB decision payload");
    await decideKyb(
      id,
      { decision: body.decision, note: body.note ?? null },
      actorFromRequest(req),
      clientIp(req),
    );
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
