/**
 * `/v1/plans/:id` — read and edit a pricing plan (SPEC §7).
 *
 * Editing produces a **new version** row (previous archived); `PATCH {status:"archived"}`
 * archives in place. See `@/lib/services/plans`.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { getPlan, updatePlan, updatePlanSchema } from "@/lib/services/plans";
import { serializePlan } from "@/lib/services/serializers";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;
    const plan = await getPlan(merchant.id, id);
    return json(serializePlan(plan), { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function PATCH(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const { id } = await ctx.params;
    const body = parseOrThrow(updatePlanSchema, await readJsonBody(req), "Invalid plan payload");
    const plan = await updatePlan(merchant.id, id, body);
    return json(serializePlan(plan), { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
