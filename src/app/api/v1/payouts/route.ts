/**
 * `/v1/payouts` — request and list merchant payouts (SPEC §0, §7).
 *
 * Auth: merchant API key. A request reserves available balance; an admin must
 * approve it (two-person rule) before any money moves.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { listPayouts, requestPayout } from "@/lib/payouts/service";
import { payoutRequestSchema } from "@/lib/payouts/validation";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

const PAYOUT_STATUSES = ["requested", "approved", "rejected", "paid"] as const;

const listQuerySchema = z
  .object({
    status: z.enum(PAYOUT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const data = await listPayouts(merchant.id, { status: query.status, limit: query.limit });
    return json({ data });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const input = parseOrThrow(
      payoutRequestSchema,
      await readJsonBody(req),
      "Invalid payout payload",
    );
    const payout = await requestPayout({
      merchantId: merchant.id,
      actor: actorFromRequest(req),
      ip: clientIp(req),
      input,
    });
    return json(payout, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
