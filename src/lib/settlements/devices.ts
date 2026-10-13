/**
 * Device fleet administration (SPEC §6 — devices are platform-scoped).
 *
 * Devices only forward SMS for the shared wallet pool; pairing exchanges a
 * short-lived code for a device token (see `POST /v1/devices/pair`).
 */

import { recordAudit } from "@/lib/api/audit";
import { badRequest, internal, notFound } from "@/lib/api/errors";
import { generateToken } from "@/lib/api/crypto";
import { db } from "@/lib/db/client";
import type { Device, Json } from "@/lib/db/types";

/** How long a pairing code is valid, in minutes. */
export const PAIRING_CODE_TTL_MINUTES = 15;

/** List the device fleet, newest first. */
export async function listDevices(): Promise<Device[]> {
  const { data, error } = await db()
    .from("devices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw internal("Failed to list devices", { code: error.code });
  return (data as unknown as Device[] | null) ?? [];
}

async function loadDevice(deviceId: string): Promise<Device> {
  const { data, error } = await db()
    .from("devices")
    .select("*")
    .eq("id", deviceId)
    .maybeSingle();
  if (error) throw internal("Failed to load device", { code: error.code });
  const device = data as unknown as Device | null;
  if (!device) throw notFound("Device not found");
  return device;
}

/** Revoke a device; its token can no longer authenticate (SPEC §9). */
export async function revokeDevice(
  deviceId: string,
  actor: string,
  ip: string | null,
): Promise<void> {
  const before = await loadDevice(deviceId);
  const { error } = await db()
    .from("devices")
    .update({ status: "revoked" })
    .eq("id", deviceId);
  if (error) throw internal("Failed to revoke device", { code: error.code });

  await recordAudit({
    actor,
    action: "device.revoke",
    entityType: "device",
    entityId: deviceId,
    before: before as unknown as Json,
    after: { ...before, status: "revoked" } as unknown as Json,
    ip,
  });
}

/** Flush a device's pending SMS queue (drop un-forwarded messages). */
export async function flushDevice(
  deviceId: string,
  actor: string,
  ip: string | null,
): Promise<void> {
  const before = await loadDevice(deviceId);
  const { error } = await db()
    .from("devices")
    .update({ queue_depth: 0 })
    .eq("id", deviceId);
  if (error) throw internal("Failed to flush device queue", { code: error.code });

  await recordAudit({
    actor,
    action: "device.flush",
    entityType: "device",
    entityId: deviceId,
    before: { queue_depth: before.queue_depth } as unknown as Json,
    after: { queue_depth: 0 } as unknown as Json,
    ip,
  });
}

export interface PairingCodeDTO {
  code: string;
  expires_at: string;
  merchant_id: string;
}

/**
 * Mint a one-time pairing code.
 *
 * A pairing code is merchant-scoped (`device_pairing_codes.merchant_id`, not
 * null) even though devices themselves are platform-wide. The admin console does
 * not send a merchant, so we fall back to an existing merchant.
 *
 * TODO(schema): make pairing codes platform-scoped (drop the `merchant_id`
 * column) now that devices carry no merchant, or thread a merchant selector
 * through the console.
 */
export async function createPairingCode(
  merchantId: string | null,
  actor: string,
  ip: string | null,
): Promise<PairingCodeDTO> {
  let scopeMerchantId = merchantId;
  if (!scopeMerchantId) {
    const { data, error } = await db()
      .from("merchants")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw internal("Failed to scope pairing code", { code: error.code });
    const fallback = data as unknown as { id: string } | null;
    if (!fallback) throw badRequest("No merchant exists to scope the pairing code");
    scopeMerchantId = fallback.id;
  }

  const code = generateToken(4).toUpperCase();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000).toISOString();

  const { error } = await db().from("device_pairing_codes").insert({
    code,
    merchant_id: scopeMerchantId,
    expires_at: expiresAt,
    used_at: null,
  });
  if (error) throw internal("Failed to create pairing code", { code: error.code });

  await recordAudit({
    actor,
    action: "device.pairing_code.create",
    entityType: "device_pairing_code",
    entityId: code,
    after: { merchant_id: scopeMerchantId, expires_at: expiresAt } as unknown as Json,
    ip,
  });

  return { code, expires_at: expiresAt, merchant_id: scopeMerchantId };
}
