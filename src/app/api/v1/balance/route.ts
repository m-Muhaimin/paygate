/**
 * `/v1/balance` — merchant balance summary (SPEC §7).
 *
 * Auth: merchant API key. All amounts integer paisa; balances are ledger-derived.
 */

import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import { getBalanceSummary } from "@/lib/settlements/service";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    return json(await getBalanceSummary(merchant.id));
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
