/**
 * `/v1/webhooks/deliveries` — inspect webhook delivery attempts (SPEC §7).
 *
 * Auth: merchant API key.
 */

import { z } from "zod";

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow } from "@/lib/services/validation";
import { listDeliveries } from "@/lib/webhooks/inspector";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const rows = await listDeliveries(merchant.id, query.limit ?? 50);
    return json({ data: rows ?? [] });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
