/**
 * Device (SMS forwarder) authentication for `/v1/sms/webhook` and
 * `/v1/devices/heartbeat`.
 *
 * A paired device presents its long-lived device token as
 * `Authorization: Bearer <token>` (SPEC §7, PRD §5). We look the device up by the
 * SHA-256 hash of the presented token, reject `revoked` devices with 401, and
 * confirm the match with a constant-time `verifySecret` check.
 */

import { internal, unauthorized } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Device } from "@/lib/db/types";

import { hashSecret, verifySecret } from "./crypto";
import { getBearerToken } from "./keys";

/**
 * Authenticate a device request.
 *
 * @throws `unauthorized()` (401) for a missing/unknown token or a revoked device.
 */
export async function authenticateDevice(req: Request): Promise<{ device: Device }> {
  const token = getBearerToken(req);
  if (!token) {
    throw unauthorized("Missing device token");
  }

  const tokenHash = await hashSecret(token);
  const { data, error } = await db()
    .from("devices")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    throw internal("Failed to verify device token", { code: error.code });
  }
  const device = data as unknown as Device | null;
  if (!device || !device.token_hash) {
    throw unauthorized("Invalid device token");
  }
  if (device.status === "revoked") {
    throw unauthorized("Device revoked");
  }
  if (!(await verifySecret(token, device.token_hash))) {
    throw unauthorized("Invalid device token");
  }

  return { device };
}

/**
 * Merchant-scoped device guard used by the device-facing routes.
 *
 * NOTE (flagged to the controller): the device fleet is platform-scoped — `devices`
 * carries no `merchant_id` (db.md §6.2) and no device→merchant mapping exists in the
 * schema, so a device cannot be bound to a merchant at the data layer. This guard
 * therefore authenticates the device (active, paired, not revoked) and returns it;
 * routing/scoping is enforced on the trusted `service_role` server path. If a
 * device→merchant binding is required later, add `devices.merchant_id` (or a
 * device_pairings table) and enforce it here.
 *
 * @throws `unauthorized()` (401) — same cases as `authenticateDevice`.
 */
export async function requireDeviceMerchant(req: Request): Promise<{ device: Device }> {
  return authenticateDevice(req);
}
