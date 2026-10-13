/**
 * `/v1/payments` — create and list payments (SPEC §7).
 *
 * `POST` requires an `Idempotency-Key` header (SPEC §7); a replay returns the
 * original payment unchanged. Auth: merchant API key.
 */

import { z } from "zod";

import { badRequest } from "@/lib/api/errors";
import { errorResponse, getRequestId, json } from "@/lib/api/http";
import { authenticateMerchant } from "@/lib/api/tenant";
import type { Json } from "@/lib/db/types";
import { createPayment, createPaymentSchema, listPayments } from "@/lib/services/payments";
import { serializePayment } from "@/lib/services/serializers";
import { parseOrThrow, readJsonBody } from "@/lib/services/validation";

const listQuerySchema = z
  .object({
    status: z
      .enum([
        "created",
        "awaiting_payment",
        "confirming",
        "paid",
        "expired",
        "cancelled",
        "needs_review",
      ])
      .optional(),
    provider: z.enum(["bkash", "nagad", "rocket"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);

    const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
    if (!idempotencyKey) throw badRequest("Idempotency-Key header is required");

    const body = parseOrThrow(
      createPaymentSchema,
      await readJsonBody(req),
      "Invalid payment payload",
    );

    const { payment, wallet, payUrl } = await createPayment({
      merchant,
      planId: body.plan_id,
      orderId: body.order_id,
      provider: body.provider,
      callbackUrl: body.callback_url ?? null,
      successUrl: body.success_url ?? null,
      cancelUrl: body.cancel_url ?? null,
      metadata: (body.metadata ?? null) as Json | null,
      idempotencyKey,
      origin: new URL(req.url).origin,
    });

    return json(serializePayment(payment, { wallet, payUrl }), { status: 201 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export async function GET(req: Request): Promise<Response> {
  const requestId = getRequestId(req);
  try {
    const { merchant } = await authenticateMerchant(req);
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const query = parseOrThrow(listQuerySchema, params, "Invalid query parameters");
    const { data, next_cursor } = await listPayments(merchant.id, {
      status: query.status,
      provider: query.provider,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return json({ data: data.map((p) => serializePayment(p)), next_cursor }, { status: 200 });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
