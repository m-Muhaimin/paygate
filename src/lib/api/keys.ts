/**
 * Merchant API key minting, hashing and masking.
 *
 * A key is `sk_live_<64 hex>` / `sk_test_<64 hex>` — a 256-bit random token from
 * `generateToken`. Only the SHA-256 hash is persisted (`api_keys.key_hash`); the
 * plaintext is shown once at creation (SPEC §9 "API keys hashed at rest"). The
 * unsalted-SHA-256 rationale lives in `./crypto.ts` (high-entropy secrets only).
 */

import { z } from "zod";

import { generateToken, hashSecret } from "./crypto";

export type ApiKeyMode = "live" | "test";

/** The stored `api_keys.prefix` value for a mode. */
export type ApiKeyPrefix = "sk_live_" | "sk_test_";

export interface GeneratedApiKey {
  /** Full key — return to the caller once, never store. */
  plaintext: string;
  /** SHA-256 hex digest to persist in `api_keys.key_hash`. */
  hash: string;
  /** Stored prefix (`api_keys.prefix`). */
  prefix: ApiKeyPrefix;
}

/** Mint a new API key for the given mode. */
export async function generateApiKey(mode: ApiKeyMode): Promise<GeneratedApiKey> {
  const prefix: ApiKeyPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  const plaintext = `${prefix}${generateToken(32)}`;
  const hash = await hashSecret(plaintext);
  return { plaintext, hash, prefix };
}

/** Hash an API key for lookup against `api_keys.key_hash`. */
export function hashApiKey(plaintext: string): Promise<string> {
  return hashSecret(plaintext);
}

/** Render a safe display form, e.g. `sk_live_…abcd` (scheme + last 4). */
export function maskApiKey(plaintext: string): string {
  const scheme = plaintext.startsWith("sk_live_")
    ? "sk_live_"
    : plaintext.startsWith("sk_test_")
      ? "sk_test_"
      : "";
  return `${scheme}…${plaintext.slice(-4)}`;
}

const bearerSchema = z
  .string()
  .regex(/^Bearer\s+(\S+)$/i, "malformed bearer authorization header")
  .transform((value) => value.replace(/^Bearer\s+/i, "").trim());

/**
 * Extract a bearer credential from the `Authorization` header.
 * Returns `null` for a missing or malformed header (callers raise 401).
 */
export function getBearerToken(req: Request): string | null {
  const raw = req.headers.get("authorization");
  if (!raw) return null;
  const parsed = bearerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
