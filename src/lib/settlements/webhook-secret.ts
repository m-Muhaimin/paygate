/**
 * Webhook signing-secret rotation (SPEC §7 merchant, §9 security).
 *
 * The plaintext secret is shown exactly once; only its SHA-256 hash is stored in
 * `merchants.webhook_secret_hash`. The raw secret never touches the audit log.
 */

import { recordAudit } from "@/lib/api/audit";
import { internal } from "@/lib/api/errors";
import { generateToken, hashSecret } from "@/lib/api/crypto";
import { db } from "@/lib/db/client";
import type { Json, Merchant } from "@/lib/db/types";

export interface RotatedSecret {
  /** New plaintext signing secret (`whsec_…`) — return once, never persist. */
  secret: string;
}

/**
 * Rotate the merchant's webhook signing secret.
 *
 * TODO(schema): SPEC §9 asks for (at least) a 24h overlap during which both the
 * old and new secrets verify. `merchants` only has a single `webhook_secret_hash`
 * column, so the previous secret is invalidated immediately. Honouring the
 * overlap needs `webhook_secret_prev_hash` + `webhook_secret_rotated_at` columns
 * (and a matching change in the verifier).
 */
export async function rotateWebhookSecret(
  merchant: Merchant,
  actor: string,
  ip: string | null,
): Promise<RotatedSecret> {
  const secret = `whsec_${generateToken(32)}`;
  const hash = await hashSecret(secret);

  const { error } = await db()
    .from("merchants")
    .update({ webhook_secret_hash: hash })
    .eq("id", merchant.id);
  if (error) throw internal("Failed to rotate webhook secret", { code: error.code });

  await recordAudit({
    actor,
    action: "merchant.webhook_secret_rotate",
    entityType: "merchant",
    entityId: merchant.id,
    // Never log the secret itself — only the fact that one existed before.
    before: { had_secret: merchant.webhook_secret_hash !== null } as unknown as Json,
    after: { rotated_at: new Date().toISOString(), had_secret: true } as unknown as Json,
    ip,
  });

  return { secret };
}
