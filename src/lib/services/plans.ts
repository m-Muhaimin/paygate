/**
 * Pricing-plan service (SPEC §6 `pricing_plans`, §7 `/v1/plans`).
 *
 * Business rules:
 *   - A plan is either **fixed-amount** (`amount` set, `open_amount = false`) or
 *     **open-amount** (`amount` null, `min_amount`/`max_amount` set). This mirrors
 *     the DB constraint `pricing_plans_amount_consistency_check`.
 *   - Editing a plan never mutates it in place: a new `version` row is inserted
 *     (`version + 1`) and the previous row is archived (SPEC §7 "edit = new version;
 *     archive"). Archiving without an edit just flips the current row to `archived`.
 */

import { z } from "zod";

import { badRequest, internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import { newId, PRE } from "@/lib/domain/ids";
import type { PlanStatus, PricingPlan } from "@/lib/db/types";

const CURRENCY = "BDT";

export const createPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    amount: z.number().int().nonnegative().nullish(),
    external_sku: z.string().trim().min(1).max(120).nullish(),
    open_amount: z.boolean().optional(),
    min_amount: z.number().int().nonnegative().nullish(),
    max_amount: z.number().int().nonnegative().nullish(),
  })
  .strict();

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    amount: z.number().int().nonnegative().nullish(),
    external_sku: z.string().trim().min(1).max(120).nullish(),
    open_amount: z.boolean().optional(),
    min_amount: z.number().int().nonnegative().nullish(),
    max_amount: z.number().int().nonnegative().nullish(),
    /** Only `archived` may be set via PATCH (a new version is always `active`). */
    status: z.literal("archived").optional(),
  })
  .strict();

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

interface AmountShape {
  open_amount: boolean;
  amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
}

/** Enforce the fixed/open amount rule (mirrors the DB check constraint). */
function assertAmountConsistency(shape: AmountShape): void {
  if (!shape.open_amount) {
    if (shape.amount === null) {
      throw badRequest("amount is required for a fixed-amount plan");
    }
    return;
  }
  if (shape.amount !== null) {
    throw badRequest("amount must be omitted for an open-amount plan");
  }
  if (shape.min_amount === null || shape.max_amount === null) {
    throw badRequest("min_amount and max_amount are required for an open-amount plan");
  }
  if (shape.min_amount > shape.max_amount) {
    throw badRequest("min_amount must not exceed max_amount");
  }
}

export interface ListPlansFilters {
  status?: PlanStatus;
}

/** List a merchant's plans, newest first. */
export async function listPlans(
  merchantId: string,
  filters: ListPlansFilters = {},
): Promise<PricingPlan[]> {
  const base = db()
    .from("pricing_plans")
    .select("*")
    .eq("merchant_id", merchantId);
  const scoped = filters.status ? base.eq("status", filters.status) : base;
  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw internal("Failed to list plans", { code: error.code });
  return (data as unknown as PricingPlan[] | null) ?? [];
}

/** Load one plan scoped to its merchant, or throw `404`. */
export async function getPlan(merchantId: string, planId: string): Promise<PricingPlan> {
  const { data, error } = await db()
    .from("pricing_plans")
    .select("*")
    .eq("id", planId)
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw internal("Failed to load plan", { code: error.code });
  const plan = data as unknown as PricingPlan | null;
  if (!plan) throw notFound("Plan not found");
  return plan;
}

/** Create a fixed- or open-amount plan (version 1, active). */
export async function createPlan(
  merchantId: string,
  input: CreatePlanInput,
): Promise<PricingPlan> {
  const open = input.open_amount ?? false;
  const amount = open ? null : (input.amount ?? null);
  const min = open ? (input.min_amount ?? null) : null;
  const max = open ? (input.max_amount ?? null) : null;
  assertAmountConsistency({ open_amount: open, amount, min_amount: min, max_amount: max });

  const { data, error } = await db()
    .from("pricing_plans")
    .insert({
      id: newId(PRE.plan),
      merchant_id: merchantId,
      name: input.name,
      amount,
      currency: CURRENCY,
      external_sku: input.external_sku ?? null,
      version: 1,
      status: "active" satisfies PlanStatus,
      open_amount: open,
      min_amount: min,
      max_amount: max,
    })
    .select()
    .single();
  if (error) throw internal("Failed to create plan", { code: error.code });
  return data as unknown as PricingPlan;
}

/**
 * Edit a plan. Field edits produce a **new version** row (`version + 1`, active)
 * and archive the previous one; a bare `status: "archived"` archives in place.
 * Returns the resulting (new or archived) row.
 */
export async function updatePlan(
  merchantId: string,
  planId: string,
  input: UpdatePlanInput,
): Promise<PricingPlan> {
  const current = await getPlan(merchantId, planId);

  const hasEdits =
    input.name !== undefined ||
    input.amount !== undefined ||
    input.external_sku !== undefined ||
    input.open_amount !== undefined ||
    input.min_amount !== undefined ||
    input.max_amount !== undefined;

  if (!hasEdits) {
    if (input.status === undefined) throw badRequest("No changes supplied");
    if (current.status === "archived") return current; // already archived — idempotent
    const { data, error } = await db()
      .from("pricing_plans")
      .update({ status: "archived" })
      .eq("id", planId)
      .eq("merchant_id", merchantId)
      .select()
      .single();
    if (error) throw internal("Failed to archive plan", { code: error.code });
    return data as unknown as PricingPlan;
  }

  const open = input.open_amount ?? current.open_amount;
  const amount = open ? null : input.amount === undefined ? current.amount : input.amount;
  const min = open
    ? input.min_amount === undefined
      ? current.min_amount
      : input.min_amount
    : null;
  const max = open
    ? input.max_amount === undefined
      ? current.max_amount
      : input.max_amount
    : null;
  assertAmountConsistency({ open_amount: open, amount, min_amount: min, max_amount: max });

  const { data: created, error: insertError } = await db()
    .from("pricing_plans")
    .insert({
      id: newId(PRE.plan),
      merchant_id: merchantId,
      name: input.name ?? current.name,
      amount,
      currency: current.currency,
      external_sku:
        input.external_sku === undefined ? current.external_sku : input.external_sku,
      version: current.version + 1,
      status: (input.status === "archived" ? "archived" : "active") satisfies PlanStatus,
      open_amount: open,
      min_amount: min,
      max_amount: max,
    })
    .select()
    .single();
  if (insertError) throw internal("Failed to create plan version", { code: insertError.code });

  const { error: archiveError } = await db()
    .from("pricing_plans")
    .update({ status: "archived" })
    .eq("id", planId)
    .eq("merchant_id", merchantId);
  if (archiveError) {
    throw internal("Failed to archive previous plan version", { code: archiveError.code });
  }

  return created as unknown as PricingPlan;
}
