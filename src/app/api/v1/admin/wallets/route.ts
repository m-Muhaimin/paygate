/**
 * `/v1/admin/wallets` — wallet pool administration (SPEC §7).
 *
 * Gate: `requireAdmin` (fails closed; see `@/lib/settlements/admin`).
 */

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import { requireAdmin } from "@/lib/settlements/admin";
import {
  createWallet,
  createWalletSchema,
  listWallets,
} from "@/lib/settlements/wallets";

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    return json({ data: await listWallets() });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    await requireAdmin(req);
    const body = parseOrThrow(
      createWalletSchema,
      await readJsonBody(req),
      "Invalid wallet payload",
    );
    const wallet = await createWallet(body, actorFromRequest(req), clientIp(req));
    return json(wallet, { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
