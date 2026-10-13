/**
 * POST /v1/devices/pair — exchange a short-lived pairing code for a device token
 * (SPEC §7). The token is returned once in plaintext; only its SHA-256 hash is
 * stored on `devices.token_hash`.
 */

import { db } from "@/lib/db/client";
import { json, withRequestId } from "@/lib/api/http";
import { badRequest, unauthorized, internal } from "@/lib/api/errors";
import { generateToken, hashSecret } from "@/lib/api/crypto";
import { newId } from "@/lib/domain/ids";

async function handlePair(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || code.length === 0) throw badRequest("code_required");

  const supabase = db();
  const { data: pairing, error } = await supabase
    .from("device_pairing_codes")
    .select("code,merchant_id,expires_at,used_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw internal("pairing_lookup_failed", { code: error.code });
  if (!pairing) throw unauthorized("invalid_pairing_code");
  if (pairing.used_at) throw unauthorized("pairing_code_used");
  if (new Date(pairing.expires_at).getTime() < Date.now()) throw unauthorized("pairing_code_expired");

  const token = generateToken(32);
  const tokenHash = await hashSecret(token);
  const deviceId = newId("dev_");

  const { error: devError } = await supabase.from("devices").insert({
    id: deviceId,
    token_hash: tokenHash,
    status: "active",
  });
  if (devError) throw internal("device_create_failed", { code: devError.code });

  const { error: usedError } = await supabase
    .from("device_pairing_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code)
    .is("used_at", null);
  if (usedError) throw internal("pairing_consume_failed", { code: usedError.code });

  return json({ device_id: deviceId, device_token: token });
}

export const POST = withRequestId(handlePair);
