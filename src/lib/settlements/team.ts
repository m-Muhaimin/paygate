/**
 * Merchant team members (SPEC §7, §9).
 *
 * Reads come straight from `merchant_users`. Invitations are owned by Supabase
 * Auth (the console sends an Auth invite email, which creates the `auth.users`
 * row); a `merchant_users` row can only be created once that Auth user exists
 * because `auth_user_id` is `not null`. Until the Auth invite path is wired we
 * record the intent in the audit trail and return a pending placeholder rather
 * than fabricate an `auth_user_id`.
 */

import { z } from "zod";

import { recordAudit } from "@/lib/api/audit";
import { internal } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Json, MerchantUser, Role } from "@/lib/db/types";
import { newId } from "@/lib/domain/ids";

/** Body for `POST /v1/team/invite` (and its console alias). */
export const teamInviteSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(["owner", "staff", "developer", "viewer"]).optional(),
  })
  .strict();

export interface TeamMemberDTO {
  id: string;
  email: string | null;
  role: Role;
  created_at: string;
  two_factor_enabled?: boolean;
}

/** List a merchant's team, oldest first. */
export async function listTeamMembers(merchantId: string): Promise<TeamMemberDTO[]> {
  const { data, error } = await db()
    .from("merchant_users")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: true });
  if (error) throw internal("Failed to list team members", { code: error.code });
  return ((data as unknown as MerchantUser[] | null) ?? []).map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    // TODO(supabase-auth): surface the real `aal2` MFA state from the Auth user.
    two_factor_enabled: false,
  }));
}

export interface InviteTeamMemberInput {
  merchantId: string;
  email: string;
  role: Role;
  actor: string;
  ip?: string | null;
}

/**
 * Record a team invitation.
 *
 * TODO(supabase-auth): call `supabase.auth.admin.inviteUserByEmail(email)` and,
 * on success, insert the `merchant_users` row with the returned `user.id`. The
 * placeholder id below is *not* persisted.
 */
export async function inviteTeamMember(input: InviteTeamMemberInput): Promise<TeamMemberDTO> {
  const id = newId("mru_");
  const createdAt = new Date().toISOString();

  await recordAudit({
    actor: input.actor,
    action: "team.invite",
    entityType: "merchant_user",
    entityId: id,
    after: {
      merchant_id: input.merchantId,
      email: input.email,
      role: input.role,
      status: "invited",
      pending: true,
    } as unknown as Json,
    ip: input.ip ?? null,
  });

  return { id, email: input.email, role: input.role, created_at: createdAt, two_factor_enabled: false };
}
