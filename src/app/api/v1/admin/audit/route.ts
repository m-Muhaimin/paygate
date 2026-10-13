/**
 * `/v1/admin/audit` — read the append-only audit trail (SPEC §6, §7).
 *
 * Gate: `requireAdmin`.
 */

import { z } from "zod";

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { parseOrThrow } from "@/lib/services/validation";
import { listAdminAudit, requireAdmin } from "@/lib/settlements/admin";

const querySchema = z
  .object({
    action: z.string().min(1).max(120).optional(),
    entity_type: z.string().min(1).max(80).optional(),
    actor: z.string().min(1).max(200).optional(),
    q: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(querySchema, params, "Invalid query parameters");
    const page = await listAdminAudit({
      action: query.action,
      entity_type: query.entity_type,
      actor: query.actor,
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
    });
    return json(page);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
