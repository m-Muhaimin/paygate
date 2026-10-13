/**
 * Merchant API keys (SPEC §7 developer surface, §9).
 *
 * Only the SHA-256 hash is stored; the plaintext is returned once at creation.
 */

import { recordAudit } from "@/lib/api/audit";
import { generateApiKey, maskApiKey, type ApiKeyMode } from "@/lib/api/keys";
import { internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { ApiKey, Json } from "@/lib/db/types";
import { newId, PRE } from "@/lib/domain/ids";

export interface ApiKeyDTO {
  id: string;
  label: string | null;
  masked_key: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface CreatedApiKeyDTO extends ApiKeyDTO {
  /** Full key — returned exactly once. */
  plaintext: string;
}

/**
 * Display form. The stored row keeps only the scheme prefix and a one-way hash,
 * so listing cannot recover the last 4 characters; a `key_hint` column would be
 * needed for the `sk_live_…abcd` form on *listed* (non-newly-created) keys.
 * Newly created keys are masked from the plaintext we still hold.
 */
function toApiKeyDTO(row: ApiKey, maskedOverride?: string): ApiKeyDTO {
  return {
    id: row.id,
    label: row.label,
    masked_key: maskedOverride ?? `${row.prefix}…`,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
  };
}

/** List a merchant's API keys, newest first. */
export async function listApiKeys(merchantId: string): Promise<ApiKeyDTO[]> {
  const { data, error } = await db()
    .from("api_keys")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });
  if (error) throw internal("Failed to list API keys", { code: error.code });
  return ((data as unknown as ApiKey[] | null) ?? []).map((row) => toApiKeyDTO(row));
}

export interface CreateApiKeyInput {
  merchantId: string;
  label: string;
  mode: ApiKeyMode;
  actor: string;
  ip?: string | null;
}

/** Mint an API key. The plaintext is returned once and never persisted. */
export async function createApiKey(input: CreateApiKeyInput): Promise<CreatedApiKeyDTO> {
  const generated = await generateApiKey(input.mode);
  const id = newId(PRE.apiKey);

  const { data, error } = await db()
    .from("api_keys")
    .insert({
      id,
      merchant_id: input.merchantId,
      key_hash: generated.hash,
      prefix: generated.prefix,
      label: input.label,
    })
    .select()
    .single();
  if (error) throw internal("Failed to create API key", { code: error.code });
  const row = data as unknown as ApiKey;

  await recordAudit({
    actor: input.actor,
    action: "api_key.create",
    entityType: "api_key",
    entityId: id,
    after: {
      merchant_id: input.merchantId,
      prefix: generated.prefix,
      label: input.label,
    } as unknown as Json,
    ip: input.ip ?? null,
  });

  return { ...toApiKeyDTO(row, maskApiKey(generated.plaintext)), plaintext: generated.plaintext };
}

/** Revoke an API key. Scoped to the merchant so one tenant cannot revoke another's. */
export async function revokeApiKey(
  merchantId: string,
  keyId: string,
  actor: string,
  ip: string | null,
): Promise<void> {
  const { data, error } = await db()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("merchant_id", merchantId)
    .is("revoked_at", null)
    .select("*");
  if (error) throw internal("Failed to revoke API key", { code: error.code });
  const row = (data as unknown as ApiKey[] | null)?.[0];
  if (!row) throw notFound("API key not found or already revoked");

  await recordAudit({
    actor,
    action: "api_key.revoke",
    entityType: "api_key",
    entityId: keyId,
    after: toApiKeyDTO(row) as unknown as Json,
    ip,
  });
}
