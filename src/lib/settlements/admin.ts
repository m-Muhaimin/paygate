/**
 * Admin console shared helpers (SPEC §7 `/v1/admin/*`, §9 security).
 */

import { internal, unauthorized } from "@/lib/api/errors";
import { requireRole } from "@/lib/api/tenant";
import { db } from "@/lib/db/client";
import type { AuditLog } from "@/lib/db/types";

/**
 * Admin authorization gate — fails closed.
 *
 * Interim: when the caller presents `x-merchant-user-id`, resolve that
 * `merchant_users` row and require an `owner`/`staff` role.
 *
 * TODO(supabase-auth): SPEC §9 requires the admin console to authenticate with a
 * Supabase Auth session and a *mandatory* 2FA assertion. Resolve the session
 * (and its `aal2` claim) here, map it to `merchant_users.id`, then run the same
 * role check. Until that lands this gate refuses every unauthenticated request
 * rather than opening the admin surface.
 */
export async function requireAdmin(req: Request): Promise<void> {
  const merchantUserId = req.headers.get("x-merchant-user-id")?.trim();
  if (merchantUserId) {
    await requireRole(merchantUserId, ["owner", "staff"]);
    return;
  }
  throw unauthorized("Admin authentication required");
}

export interface AuditQuery {
  action?: string;
  entity_type?: string;
  actor?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface AuditPage {
  data: AuditLog[];
  next_cursor: string | null;
}

/** Strip PostgREST filter metacharacters from free-text search input. */
function sanitize(value: string): string {
  return value.replace(/[%,()*\\]/g, "").trim();
}

/** Paginated, filterable audit-log read for the admin console (newest first). */
export async function listAdminAudit(query: AuditQuery = {}): Promise<AuditPage> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  let builder = db().from("audit_log").select("*");
  if (query.action) builder = builder.eq("action", query.action);
  if (query.entity_type) builder = builder.eq("entity_type", query.entity_type);
  if (query.actor) builder = builder.eq("actor", query.actor);
  if (query.q) builder = builder.ilike("action", `%${sanitize(query.q)}%`);
  if (query.cursor) builder = builder.lt("created_at", query.cursor);

  const { data, error } = await builder
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) throw internal("Failed to list audit log", { code: error.code });

  const rows = (data as unknown as AuditLog[] | null) ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { data: page, next_cursor: hasMore ? page[page.length - 1]?.created_at ?? null : null };
}
