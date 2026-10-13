/**
 * `/v1/merchants/me` — merchant profile read/update (SPEC §6, §7).
 *
 * Auth: merchant API key. The stored `webhook_secret_hash` is never returned.
 */

import { z } from "zod";

import { actorFromRequest } from "@/lib/api/audit";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { clientIp } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";
import {
  serializeMerchant,
  updateMerchantProfile,
} from "@/lib/settlements/merchants";

const payoutAccountSchema = z
  .object({
    type: z.enum(["bank", "mfs"]).optional(),
    provider: z.enum(["bkash", "nagad", "rocket"]).optional(),
    account_no: z.string().trim().min(1).max(64).optional(),
    holder: z.string().trim().min(1).max(120).optional(),
    bank_name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    payout_account: payoutAccountSchema.nullish(),
    auto_confirm: z.boolean().optional(),
  })
  .strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    return json(serializeMerchant(merchant));
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const body = parseOrThrow(
      updateProfileSchema,
      await readJsonBody(req),
      "Invalid profile payload",
    );
    const profile = await updateMerchantProfile(
      merchant,
      body,
      actorFromRequest(req),
      clientIp(req),
    );
    return json(profile);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
