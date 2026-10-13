/**
 * `/v1/plans` — create and list pricing plans (SPEC §7).
 *
 * Auth: merchant API key (`Authorization: Bearer sk_live_…`).
 */

import { z } from "zod";

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { createPlan, createPlanSchema, listPlans } from "@/lib/services/plans";
import { serializePlan } from "@/lib/services/serializers";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

const listQuerySchema = z
  .object({
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const body = parseOrThrow(createPlanSchema, await readJsonBody(req), "Invalid plan payload");
    const plan = await createPlan(merchant.id, body);
    return json(serializePlan(plan), { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const { status } = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const plans = await listPlans(merchant.id, { status });
    return json({ data: plans.map(serializePlan) }, { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
