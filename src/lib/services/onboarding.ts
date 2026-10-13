/**
 * Merchant onboarding service (SPEC §7 `POST /v1/onboarding/apply`).
 *
 * A public application creates a `merchants` row in `pending`/KYB-submitted state
 * (fee rate and risk tier take their DB defaults). `merchants` has no contact
 * columns (SPEC §6), so the applicant's contact/business details are retained in
 * the append-only `audit_log` for KYB review rather than dropped.
 */

import { z } from "zod";

import { recordAudit } from "@/lib/api/audit";
import { internal } from "@/lib/api/errors";
import { logStructured } from "@/lib/api/http";
import { db } from "@/lib/db/client";
import { newId, PRE } from "@/lib/domain/ids";
import type { Json, KybStatus, MerchantStatus, PayoutAccount } from "@/lib/db/types";

export const onboardingSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(5).max(32),
    business_type: z.string().trim().min(1).max(120),
    payout_account: z
      .object({
        type: z.enum(["bank", "mfs"]).optional(),
        provider: z.enum(["bkash", "nagad", "rocket"]).optional(),
        account_no: z.string().trim().min(1).max(64).optional(),
        holder: z.string().trim().min(1).max(200).optional(),
        bank_name: z.string().trim().min(1).max(200).optional(),
      })
      .passthrough(),
  })
  .strict();

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export interface OnboardingResult {
  merchant_id: string;
  status: MerchantStatus;
}

/**
 * KYB status applied on submission.
 *
 * NOTE: the `kyb_status` enum has no literal `submitted` value (SPEC §6 /
 * migration 0001: pending | under_review | approved | rejected). A just-submitted
 * application is therefore recorded as `under_review` — the closest existing state
 * meaning "received, awaiting a decision". Change this one constant if the enum
 * gains a `submitted` value.
 */
const KYB_ON_SUBMIT: KybStatus = "under_review";

/** Create a pending merchant application and record it in the audit trail. */
export async function applyForMerchant(
  input: OnboardingInput,
  ctx: { ip?: string | null; actor?: string } = {},
): Promise<OnboardingResult> {
  const merchantId = newId(PRE.merchant);

  const { error } = await db().from("merchants").insert({
    id: merchantId,
    name: input.name,
    status: "pending" satisfies MerchantStatus,
    kyb_status: KYB_ON_SUBMIT,
    fee_rate_bps: 500,
    risk_tier: "low",
    payout_account: input.payout_account as unknown as PayoutAccount,
  });
  if (error) {
    logStructured("error", "onboarding_db_failed", { merchant_id: merchantId, error: error.message, code: error.code });
    throw internal("Failed to create merchant application", { code: error.code });
  }

  // Best-effort: the audit write must not fail an otherwise-successful application.
  try {
    await recordAudit({
      actor: ctx.actor ?? "onboarding",
      action: "onboarding.applied",
      entityType: "merchant",
      entityId: merchantId,
      after: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        business_type: input.business_type,
        payout_account: input.payout_account as unknown as Json,
      },
      ip: ctx.ip ?? null,
    });
  } catch (err) {
    logStructured("warn", "onboarding_audit_failed", {
      merchant_id: merchantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { merchant_id: merchantId, status: "pending" };
}
