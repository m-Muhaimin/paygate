/**
 * `/v1/admin/review/:id/resolve` — resolve one review case (SPEC §4, §7).
 *
 * Gate: `requireAdmin`. Accepts both the console vocabulary
 * (`resolution: matched|accepted|rejected`) and the SPEC vocabulary
 * (`action: match|dismiss|mark_paid`).
 */

import { z } from "zod";

import { actorFromRequest, recordAudit } from "@/lib/api/audit";
import { badRequest } from "@/lib/api/errors";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import { resolveReview, type ReviewAction } from "@/lib/settlements/review";

const resolveSchema = z
  .object({
    action: z.enum(["match", "dismiss", "mark_paid"]).optional(),
    resolution: z.enum(["matched", "accepted", "rejected"]).optional(),
    payment_id: z.string().trim().min(1).nullish(),
    note: z.string().max(1000).nullish(),
  })
  .strict();

const RESOLUTION_TO_ACTION: Record<"matched" | "accepted" | "rejected", ReviewAction> = {
  matched: "match",
  accepted: "mark_paid",
  rejected: "dismiss",
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = parseOrThrow(resolveSchema, await readJsonBody(req), "Invalid resolution payload");

    const action: ReviewAction | undefined =
      body.action ?? (body.resolution ? RESOLUTION_TO_ACTION[body.resolution] : undefined);
    if (!action) throw badRequest("action or resolution is required");

    const actor = actorFromRequest(req);
    const payment = await resolveReview({
      caseId: id,
      action,
      paymentId: body.payment_id ?? null,
      note: body.note ?? null,
      actor,
      ip: clientIp(req),
    });

    await recordAudit({
      actor,
      action: "review.resolve",
      entityType: "review_case",
      entityId: id,
      after: {
        action,
        payment_id: payment?.id ?? body.payment_id ?? null,
        note: body.note ?? null,
      },
      ip: clientIp(req),
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
