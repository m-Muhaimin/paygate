/**
 * `/v1/onboarding/apply` — public merchant application (SPEC §7).
 *
 * Creates a `pending` merchant and records the applicant details for KYB review.
 * Rate limited 5/min/IP.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp, enforceRateLimit } from "@/lib/api/ratelimit";
import { applyForMerchant, onboardingSchema } from "@/lib/services/onboarding";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    enforceRateLimit(req, "onboarding", 5, 60);
    const body = parseOrThrow(
      onboardingSchema,
      await readJsonBody(req),
      "Invalid onboarding payload",
    );
    const result = await applyForMerchant(body, { ip: clientIp(req), actor: "onboarding" });
    return json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
