/**
 * `/v1/settlements/export` — CSV download of settlement statements (SPEC §7).
 *
 * Auth: merchant API key. Responds with `text/csv` for the console's
 * `window.location.href` download path.
 */

import { z } from "zod";

import { errorResponse, getRequestId } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow } from "@/lib/services/validation";
import { exportSettlementsCsv } from "@/lib/settlements/service";

const exportQuerySchema = z
  .object({
    period_start: z.string().min(1).optional(),
    period_end: z.string().min(1).optional(),
    format: z.literal("csv").optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(exportQuerySchema, params, "Invalid query parameters");

    const csv = await exportSettlementsCsv(merchant.id, {
      periodStart: query.period_start,
      periodEnd: query.period_end,
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="settlements.csv"',
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
