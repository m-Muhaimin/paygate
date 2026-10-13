/**
 * Merchant (API key) authentication and role authorization for `/v1/*` routes.
 *
 * The API surface is authenticated with a merchant secret key presented as
 * `Authorization: Bearer sk_live_…` / `sk_test_…` (SPEC §7). We hash the presented
 * key and look it up by `api_keys.key_hash`, require the key to be un-revoked and
 * its merchant to be `active`, then stamp `last_used_at`. All checks happen on the
 * server — the UI never gates access.
 */

import { forbidden, internal, unauthorized } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Merchant, MerchantUser, Role } from "@/lib/db/types";

import { getBearerToken, hashApiKey } from "./keys";

interface ApiKeyLookupRow {
  id: string;
  merchant_id: string;
}

const API_KEY_PREFIXES = ["sk_live_", "sk_test_"] as const;

function isMerchantApiKey(token: string): boolean {
  return API_KEY_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/**
 * Authenticate a request with a merchant API key.
 *
 * @throws `unauthorized()` (401) when the header is missing/malformed, the key is
 *   not a merchant key, the key is revoked/unknown, or the merchant is not active.
 */
export async function authenticateMerchant(req: Request): Promise<{ merchant: Merchant }> {
  const token = getBearerToken(req);
  if (!token || !isMerchantApiKey(token)) {
    throw unauthorized("Missing or invalid API key");
  }

  const keyHash = await hashApiKey(token);

  const { data: keyRow, error: keyError } = await db()
    .from("api_keys")
    .select("id, merchant_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (keyError) {
    throw internal("Failed to verify API key", { code: keyError.code });
  }
  const key = keyRow as unknown as ApiKeyLookupRow | null;
  if (!key) {
    throw unauthorized("Invalid API key");
  }

  const { data: merchantRow, error: merchantError } = await db()
    .from("merchants")
    .select("*")
    .eq("id", key.merchant_id)
    .maybeSingle();
  if (merchantError) {
    throw internal("Failed to load merchant", { code: merchantError.code });
  }
  const merchant = merchantRow as unknown as Merchant | null;
  if (!merchant || merchant.status !== "active") {
    throw unauthorized("Merchant is not active");
  }

  // Best-effort usage stamp; a failure here must not break an otherwise valid call.
  const { error: touchError } = await db()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);
  if (touchError) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "api_key_last_used_update_failed",
        key_id: key.id,
        code: touchError.code,
      }),
    );
  }

  return { merchant };
}

/**
 * Assert a `merchant_users` row (matched by `merchant_users.id`) holds one of the
 * allowed roles. Used by the Supabase-Auth (dashboard/admin) path.
 *
 * @throws `forbidden()` (403) when the user is unknown or lacks the role.
 */
export async function requireRole(merchantUserId: string, roles: Role[]): Promise<MerchantUser> {
  const { data, error } = await db()
    .from("merchant_users")
    .select("*")
    .eq("id", merchantUserId)
    .maybeSingle();
  if (error) {
    throw internal("Failed to load merchant user", { code: error.code });
  }
  const user = data as unknown as MerchantUser | null;
  if (!user) {
    throw forbidden("Unknown merchant user");
  }
  if (!roles.includes(user.role)) {
    throw forbidden("Insufficient role");
  }
  return user;
}
