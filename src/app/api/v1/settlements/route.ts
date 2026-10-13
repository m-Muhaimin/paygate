/**
 * `/v1/settlements` — list settlement statements (SPEC §7).
 *
 * Auth: merchant API key.
 */

import { z } from "zod";

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow } from "@/lib/services/validation";
import { listSettlements } from "@/lib/settlements/service";

const listQuerySchema = z
  .object({
    period_start: z.string().min(1).optional(),
    period_end: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const data = await listSettlements(merchant.id, {
      periodStart: query.period_start,
      periodEnd: query.period_end,
      limit: query.limit,
    });
    return json({ data });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
