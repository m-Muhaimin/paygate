/**
 * `/v1/admin/wallets/:id` — update a wallet (SPEC §7).
 *
 * Gate: `requireAdmin`.
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import { updateWallet, updateWalletSchema } from "@/lib/settlements/wallets";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = parseOrThrow(
      updateWalletSchema,
      await readJsonBody(req),
      "Invalid wallet payload",
    );
    const wallet = await updateWallet(id, body, actorFromRequest(req), clientIp(req));
    return json(wallet);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
