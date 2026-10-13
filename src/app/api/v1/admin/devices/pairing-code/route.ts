/**
 * `/v1/admin/devices/pairing-code` — mint a one-time device pairing code (SPEC §7).
 *
 * Gate: `requireAdmin`. An optional `merchant_id` scopes the code; the console
 * does not send one, so we fall back to an existing merchant (see
 * `@/lib/settlements/devices`).
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import { createPairingCode } from "@/lib/settlements/devices";

const bodySchema = z
  .object({
    merchant_id: z.string().trim().min(1).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const body = parseOrThrow(bodySchema, await readJsonBody(req), "Invalid pairing payload");
    const pairing = await createPairingCode(
      body.merchant_id ?? null,
      actorFromRequest(req),
      clientIp(req),
    );
    return json(pairing, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
