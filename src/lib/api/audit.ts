/**
 * Audit trail writer (SPEC §6 `audit_log`, append-only).
 *
 * Every privileged/mutating action records an actor, action, target entity and an
 * optional before/after snapshot. `audit_log` has RLS enabled with no policies, so
 * it is only reachable through the privileged `db()` client.
 */

import { internal } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { AuditLog, Json } from "@/lib/db/types";

import { getBearerToken } from "./keys";
import { clientIp } from "./ratelimit";

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Json | null;
  after?: Json | null;
  ip?: string | null;
}

/** Append one audit row and return it. */
export async function recordAudit(input: AuditInput): Promise<AuditLog> {
  const { data, error } = await db()
    .from("audit_log")
    .insert({
      actor: input.actor,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: input.ip ?? null,
    })
    .select()
    .single();
  if (error) {
    throw internal("Failed to write audit log", { code: error.code });
  }
  return data as unknown as AuditLog;
}

function decodeJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort actor label for an inbound request:
 *   `x-actor` override → `user:<sub>` (Supabase Auth JWT) →
 *   `api_key:<sk_live_|sk_test_>` → `device` → `ip:<client ip>`.
 */
export function actorFromRequest(req: Request): string {
  const explicit = req.headers.get("x-actor")?.trim();
  if (explicit) return explicit;

  const token = getBearerToken(req);
  if (token) {
    const sub = decodeJwtSub(token);
    if (sub) return `user:${sub}`;
    if (token.startsWith("sk_live_")) return "api_key:sk_live_";
    if (token.startsWith("sk_test_")) return "api_key:sk_test_";
    return "device";
  }

  return `ip:${clientIp(req)}`;
}
