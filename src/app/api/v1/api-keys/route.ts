/**
 * `/v1/api-keys` — list and mint merchant API keys (SPEC §7 developer surface).
 *
 * Auth: merchant API key. The plaintext key is returned exactly once.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { createApiKey, listApiKeys } from "@/lib/settlements/api-keys";

const createApiKeySchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    mode: z.enum(["live", "test"]),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    return json({ data: await listApiKeys(merchant.id) });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const body = parseOrThrow(
      createApiKeySchema,
      await readJsonBody(req),
      "Invalid API key payload",
    );
    const created = await createApiKey({
      merchantId: merchant.id,
      label: body.label,
      mode: body.mode,
      actor: actorFromRequest(req),
      ip: clientIp(req),
    });
    return json(created, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
