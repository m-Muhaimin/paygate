/**
 * `/v1/pay/:id` — public hosted pay-page data (SPEC §7).
 *
 * Unauthenticated: exposes only what the customer needs to make the transfer
 * (amount, receiving wallet, reference, expiry). Rate limited 10/min/IP.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { enforceRateLimit } from "@/lib/api/ratelimit";
import { db } from "@/lib/db/client";
import { getPayPage } from "@/lib/services/payments";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** v3.1 confirm attempts allowed before the payment locks (SPEC v3.1 §B.7). */
const CONF_MAX_ATTEMPTS = 5;

/**
 * v3.1 pay-page extras kept out of the customer-safe service serializer:
 * the redirect targets and how many confirm attempts remain. Failures degrade to
 * `null`/full-attempts rather than breaking the page.
 */
async function loadConfirmState(id: string): Promise<{
  success_url: string | null;
  cancel_url: string | null;
  attempts_remaining: number;
}> {
  try {
    const { data } = await db()
      .from("payments")
      .select("success_url,cancel_url,confirm_attempts")
      .eq("id", id)
      .maybeSingle();
    const row = (data ?? {}) as {
      success_url?: string | null;
      cancel_url?: string | null;
      confirm_attempts?: number | null;
    };
    return {
      success_url: row.success_url ?? null,
      cancel_url: row.cancel_url ?? null,
      attempts_remaining: Math.max(0, CONF_MAX_ATTEMPTS - (row.confirm_attempts ?? 0)),
    };
  } catch {
    return { success_url: null, cancel_url: null, attempts_remaining: CONF_MAX_ATTEMPTS };
  }
}

export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    enforceRateLimit(req, "pay-page", 10, 60);
    const { id } = await ctx.params;
    const view = await getPayPage(id);
    const confirm = await loadConfirmState(id);
    return json({ ...view, ...confirm }, { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
