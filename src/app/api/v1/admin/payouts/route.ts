/**
 * `/v1/admin/payouts` — platform payout queue (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { z } from "zod";

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { parseOrThrow } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import { listAdminPayouts } from "@/lib/payouts/service";

const listQuerySchema = z
  .object({
    status: z.enum(["requested", "approved", "rejected", "paid"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const data = await listAdminPayouts({ status: query.status, limit: query.limit });
    return json({ data });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
