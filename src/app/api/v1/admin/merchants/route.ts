/**
 * `/v1/admin/merchants` — platform merchant list (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { requireAdmin } from "@/lib/settlements/admin";
import { listAdminMerchants } from "@/lib/settlements/merchants";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    return json({ data: await listAdminMerchants() });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
