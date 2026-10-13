/**
 * `/v1/admin/devices` — device fleet list (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { requireAdmin } from "@/lib/settlements/admin";
import { listDevices } from "@/lib/settlements/devices";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    return json({ data: await listDevices() });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
