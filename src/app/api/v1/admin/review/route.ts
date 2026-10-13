/**
 * `/v1/admin/review` — unified review queue (SPEC §4, §7).
 *
 * Gate: `requireAdmin`.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { requireAdmin } from "@/lib/settlements/admin";
import { listReviewCases } from "@/lib/settlements/review";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    return json({ data: await listReviewCases() });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
