/**
 * POST /v1/sms/webhook — device-authenticated SMS ingest (SPEC §7).
 *
 * Replies exactly: `200 {stored}` · `200 {ignored}` · `200 {duplicate}` ·
 * `401` (bad/missing device token) · `422 {unparseable}`. Rate limited 60/min.
 */

import { json, withRequestId } from "@/lib/api/http";
import { authenticateDevice } from "@/lib/api/device-auth";
import { enforceRateLimit } from "@/lib/api/ratelimit";
import { badRequest } from "@/lib/api/errors";
import { ingestSms } from "@/lib/sms/ingest";

async function handleSmsWebhook(req: Request): Promise<Response> {
  enforceRateLimit(req, "sms_webhook", 60, 60);

  const { device } = await authenticateDevice(req);

  const body = await req.json().catch(() => null);
  if (!body) throw badRequest("invalid_payload");

  const { sender, body: smsBody, client_msg_id, received_at, sim_slot, ref_hint, parser_version } =
    body as Record<string, unknown>;

  if (typeof sender !== "string" || typeof smsBody !== "string" || typeof client_msg_id !== "string") {
    throw badRequest("missing_fields");
  }

  const result = await ingestSms({
    sender,
    body: smsBody,
    client_msg_id,
    received_at: typeof received_at === "string" ? received_at : undefined,
    sim_slot: typeof sim_slot === "number" ? sim_slot : undefined,
    ref_hint: typeof ref_hint === "string" ? ref_hint : undefined,
    parser_version: typeof parser_version === "string" ? parser_version : undefined,
    device_id: device.id,
  });

  switch (result) {
    case "duplicate":
      return json({ duplicate: true });
    case "ignored":
      return json({ ignored: true });
    case "unparseable":
      return json({ unparseable: true }, { status: 422 });
    case "stored":
    default:
      return json({ stored: true });
  }
}

export const POST = withRequestId(handleSmsWebhook);
