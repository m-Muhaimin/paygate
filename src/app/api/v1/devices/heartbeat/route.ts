/**
 * POST /v1/devices/heartbeat — device liveness + config sync (SPEC §7).
 * Device-token authenticated; updates liveness and returns server config.
 */

import { db } from "@/lib/db/client";
import { json, withRequestId } from "@/lib/api/http";
import { authenticateDevice } from "@/lib/api/device-auth";
import { internal } from "@/lib/api/errors";
import type { Json } from "@/lib/db/types";

/** Sender allowlist the phone should forward (SPEC §9 spoof defence). */
const ALLOWED_SENDERS = ["bKash", "NAGAD", "16216"];

/** Minimum supported phone app version. */
const MIN_APP_VERSION = "1.0.0";

async function handleHeartbeat(req: Request): Promise<Response> {
  const { device } = await authenticateDevice(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = { last_heartbeat_at: new Date().toISOString() };
  if (typeof body.battery === "number") patch.battery = body.battery;
  if (typeof body.queue_depth === "number") patch.queue_depth = body.queue_depth;
  if (typeof body.app_version === "string") patch.app_version = body.app_version;
  if (body.permissions && typeof body.permissions === "object") {
    patch.permissions = body.permissions as Json;
  }

  const { error } = await db().from("devices").update(patch).eq("id", device.id);
  if (error) throw internal("heartbeat_update_failed", { code: error.code });

  return json({
    server_time: new Date().toISOString(),
    allowed_senders: ALLOWED_SENDERS,
    min_app_version: MIN_APP_VERSION,
  });
}

export const POST = withRequestId(handleHeartbeat);
