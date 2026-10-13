/**
 * Idempotency for `POST /v1/payments` (SPEC §7 requires an `Idempotency-Key` header).
 *
 * The DB enforces uniqueness with a partial unique index on
 * `payments(merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
 * (db.md §2). The pattern is: look the key up first; if a payment already exists,
 * return it; otherwise run the create. If two requests race, the loser hits the
 * unique index (23505) and re-reads the winner's row.
 */

import { internal } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Payment } from "@/lib/db/types";

/** Fetch the payment already created under `(merchantId, key)`, or `null`. */
export async function findByIdempotencyKey(
  merchantId: string,
  key: string,
): Promise<Payment | null> {
  const { data, error } = await db()
    .from("payments")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) {
    throw internal("Failed to look up idempotency key", { code: error.code });
  }
  return (data as unknown as Payment | null) ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "23505") return true;
  const details = (err as { details?: unknown }).details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { code?: unknown }).code === "23505"
  );
}

/**
 * Run `fn` at most once per `(merchantId, key)`, returning the existing payment when
 * the key was already used. A `null`/omitted key runs `fn` unconditionally (best
 * effort only — callers should require the key, per SPEC §7).
 */
export async function withIdempotency(
  merchantId: string,
  key: string | null | undefined,
  fn: () => Promise<Payment>,
): Promise<Payment> {
  if (!key) return fn();

  const existing = await findByIdempotencyKey(merchantId, key);
  if (existing) return existing;

  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByIdempotencyKey(merchantId, key);
      if (winner) return winner;
    }
    throw err;
  }
}
