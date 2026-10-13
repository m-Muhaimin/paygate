/**
 * Merchant profile + KYB helpers (SPEC §6, §7).
 */

import { recordAudit } from "@/lib/api/audit";
import { badRequest, internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Json, KybStatus, Merchant } from "@/lib/db/types";

/** API-safe merchant profile (never includes `webhook_secret_hash`). */
export interface MerchantProfile {
  id: string;
  name: string;
  status: Merchant["status"];
  kyb_status: Merchant["kyb_status"];
  payout_account: Merchant["payout_account"];
  fee_rate_bps: number;
  risk_tier: Merchant["risk_tier"];
  /** SPEC v3.1 §A — auto-confirm a matching SMS without a customer Confirm. */
  auto_confirm: boolean;
  created_at: string;
}

export function serializeMerchant(merchant: Merchant): MerchantProfile {
  const autoConfirm = (merchant as unknown as { auto_confirm?: boolean }).auto_confirm ?? false;
  return {
    id: merchant.id,
    name: merchant.name,
    status: merchant.status,
    kyb_status: merchant.kyb_status,
    payout_account: merchant.payout_account,
    fee_rate_bps: merchant.fee_rate_bps,
    risk_tier: merchant.risk_tier,
    auto_confirm: autoConfirm,
    created_at: merchant.created_at,
  };
}

export interface UpdateProfileInput {
  name?: string;
  payout_account?: Merchant["payout_account"];
  auto_confirm?: boolean;
}

/** Apply a profile patch. `auto_confirm` is best-effort (SPEC v3.1 column may be absent). */
export async function updateMerchantProfile(
  merchant: Merchant,
  input: UpdateProfileInput,
  actor: string,
  ip: string | null,
): Promise<MerchantProfile> {
  if (input.name === undefined && input.payout_account === undefined && input.auto_confirm === undefined) {
    throw badRequest("No changes supplied");
  }

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.payout_account !== undefined) update.payout_account = input.payout_account;

  const persist = async (includeAutoConfirm: boolean) => {
    const payload =
      includeAutoConfirm && input.auto_confirm !== undefined
        ? { ...update, auto_confirm: input.auto_confirm }
        : update;
    return db().from("merchants").update(payload).eq("id", merchant.id).select().single();
  };

  let { data, error } = await persist(true);
  if (error && input.auto_confirm !== undefined) {
    ({ data, error } = await persist(false));
  }
  if (error) throw internal("Failed to update merchant", { code: error.code });

  const updated = data as unknown as Merchant;
  await recordAudit({
    actor,
    action: "merchant.update",
    entityType: "merchant",
    entityId: merchant.id,
    before: serializeMerchant(merchant) as unknown as Json,
    after: serializeMerchant(updated) as unknown as Json,
    ip,
  });
  return serializeMerchant(updated);
}

export interface AdminMerchantRow extends MerchantProfile {
  lifetime_gross: number;
  payment_count: number;
}

/** Platform merchant list for the admin console, with light paid-payment aggregates. */
export async function listAdminMerchants(): Promise<AdminMerchantRow[]> {
  const { data, error } = await db()
    .from("merchants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw internal("Failed to list merchants", { code: error.code });
  const merchants = (data as unknown as Merchant[] | null) ?? [];

  const { data: paidRows, error: paidError } = await db()
    .from("payments")
    .select("merchant_id, amount")
    .eq("status", "paid");
  if (paidError) throw internal("Failed to aggregate merchant payments", { code: paidError.code });

  const totals = new Map<string, { gross: number; count: number }>();
  for (const row of (paidRows as unknown as { merchant_id: string; amount: number | null }[] | null) ?? []) {
    const current = totals.get(row.merchant_id) ?? { gross: 0, count: 0 };
    current.gross += row.amount ?? 0;
    current.count += 1;
    totals.set(row.merchant_id, current);
  }

  return merchants.map((merchant) => {
    const agg = totals.get(merchant.id) ?? { gross: 0, count: 0 };
    return {
      ...serializeMerchant(merchant),
      lifetime_gross: agg.gross,
      payment_count: agg.count,
    };
  });
}

export interface KybDecisionInput {
  decision: "approved" | "rejected";
  note?: string | null;
}

/** Apply a KYB decision. Approval also activates a pending merchant. */
export async function decideKyb(
  merchantId: string,
  input: KybDecisionInput,
  actor: string,
  ip: string | null,
): Promise<Merchant> {
  const { data: found, error } = await db()
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .maybeSingle();
  if (error) throw internal("Failed to load merchant", { code: error.code });
  const before = found as unknown as Merchant | null;
  if (!before) throw notFound("Merchant not found");

  const kyb_status: KybStatus = input.decision;
  const patch: Record<string, unknown> = { kyb_status };
  if (input.decision === "approved" && before.status === "pending") {
    patch.status = "active";
  }

  const { data, error: updateError } = await db()
    .from("merchants")
    .update(patch)
    .eq("id", merchantId)
    .select()
    .single();
  if (updateError) throw internal("Failed to update KYB decision", { code: updateError.code });
  const after = data as unknown as Merchant;

  await recordAudit({
    actor,
    action: "merchant.kyb_decision",
    entityType: "merchant",
    entityId: merchantId,
    before: serializeMerchant(before) as unknown as Json,
    after: { ...serializeMerchant(after), note: input.note ?? null } as unknown as Json,
    ip,
  });
  return after;
}
