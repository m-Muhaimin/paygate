/**
 * Payout service (SPEC §0, §6, §7).
 *
 * Money chain for a payout:
 *   request (merchant)  -> `requested`, reserves available balance
 *   approve (admin)     -> `approved`, TWO-PERSON rule (approver != requester),
 *                          posts a `payout` debit ledger entry
 *   reject  (admin)     -> `rejected`, no ledger movement
 *   paid    (ops rail)   -> `paid` (out of scope for these routes)
 *
 * All mutations are audit-logged by the caller-supplied actor. Ledger amounts are
 * integer paisa; the payout debit reduces `merchant_payable` via `merchant_balance`.
 */

import { recordAudit } from "@/lib/api/audit";
import { ApiError, badRequest, conflict, forbidden, internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Json, Payout, PayoutStatus } from "@/lib/db/types";
import { newId, PRE } from "@/lib/domain/ids";
import { merchantBalance } from "@/lib/db/rpc";

import type { PayoutRequestInput } from "./validation";
import { validatePayoutAmount } from "./validation";
import { PENDING_PAYOUT_STATUSES } from "./constants";

export interface RequestPayoutArgs {
  merchantId: string;
  actor: string;
  ip?: string | null;
  input: PayoutRequestInput;
}

/**
 * Sum of amounts for a merchant's payouts that still reserve balance
 * (`requested` only). `approved` payouts are already debited from the ledger by
 * `approve_payout`, so they must not be counted here or the reservation is
 * double-subtracted. Pass `excludePayoutId` to revalidate a payout without
 * counting its own reservation twice.
 */
export async function pendingPayoutTotal(
  merchantId: string,
  excludePayoutId?: string,
): Promise<number> {
  let query = db()
    .from("payouts")
    .select("amount")
    .eq("merchant_id", merchantId)
    .in("status", [...PENDING_PAYOUT_STATUSES]);
  if (excludePayoutId) query = query.neq("id", excludePayoutId);
  const { data, error } = await query;
  if (error) throw internal("Failed to compute pending payouts", { code: error.code });
  const rows = (data as unknown as { amount: number | null }[] | null) ?? [];
  return rows.reduce((total, row) => total + (row.amount ?? 0), 0);
}

/**
 * Spendable balance = ledger balance minus payouts still reserving funds
 * (`requested` only). The `merchant_balance` RPC reflects posted ledger debits,
 * which already include every `approved` payout; only `requested` payouts are
 * not yet on the ledger and so are subtracted separately (F1).
 */
export async function spendableBalance(
  merchantId: string,
  excludePayoutId?: string,
): Promise<number> {
  const [ledger, pending] = await Promise.all([
    merchantBalance(merchantId),
    pendingPayoutTotal(merchantId, excludePayoutId),
  ]);
  return ledger - pending;
}

/** Create a payout request after checking the minimum threshold and balance. */
export async function requestPayout(args: RequestPayoutArgs): Promise<Payout> {
  const available = await spendableBalance(args.merchantId);
  validatePayoutAmount(args.input.amount, available);

  const id = newId(PRE.payout);
  const row = {
    id,
    merchant_id: args.merchantId,
    amount: args.input.amount,
    rail: args.input.rail,
    destination: args.input.destination ?? {},
    status: "requested" satisfies PayoutStatus,
    requested_by: args.actor,
    approved_by: null,
    approved_at: null,
  };

  const { data, error } = await db().from("payouts").insert(row).select().single();
  if (error) throw internal("Failed to create payout", { code: error.code });
  const payout = data as unknown as Payout;

  await recordAudit({
    actor: args.actor,
    action: "payout.request",
    entityType: "payout",
    entityId: id,
    after: payout as unknown as Json,
    ip: args.ip ?? null,
  });

  return payout;
}

/** List a single merchant's payouts, newest first. */
export async function listPayouts(
  merchantId: string,
  filters: { status?: PayoutStatus; limit?: number } = {},
): Promise<Payout[]> {
  let query = db().from("payouts").select("*").eq("merchant_id", merchantId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);
  if (error) throw internal("Failed to list payouts", { code: error.code });
  return (data as unknown as Payout[] | null) ?? [];
}

/** List payouts across the platform for the admin console. */
export async function listAdminPayouts(
  filters: { status?: PayoutStatus; limit?: number } = {},
): Promise<Payout[]> {
  let query = db().from("payouts").select("*");
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200);
  if (error) throw internal("Failed to list payouts", { code: error.code });
  return (data as unknown as Payout[] | null) ?? [];
}

async function loadPayout(payoutId: string): Promise<Payout> {
  const { data, error } = await db()
    .from("payouts")
    .select("*")
    .eq("id", payoutId)
    .maybeSingle();
  if (error) throw internal("Failed to load payout", { code: error.code });
  const payout = data as unknown as Payout | null;
  if (!payout) throw notFound("Payout not found");
  return payout;
}

export interface ApprovePayoutArgs {
  payoutId: string;
  actor: string;
  ip?: string | null;
  note?: string | null;
}

/**
 * Approve a payout under the two-person (maker-checker) rule.
 *
 * Delegates the whole mutation to the atomic `approve_payout` RPC (F2): status
 * guard, two-person check, and the ledger debit all happen in one transaction,
 * so concurrent approvals cannot double-debit.
 *
 * @throws `notFound()` (404) when the payout does not exist.
 * @throws `conflict()` (409) when the payout is not `requested`.
 * @throws `forbidden()` (403) when the approver is the requester.
 * @throws `badRequest()` (400) when the merchant lacks sufficient balance.
 */
export async function approvePayout(args: ApprovePayoutArgs): Promise<Payout> {
  const before = await loadPayout(args.payoutId); // snapshot for the audit trail

  const { data, error } = await db().rpc("approve_payout", {
    p_payout_id: args.payoutId,
    p_actor: args.actor,
  });
  if (error) throw mapApprovePayoutError(error.message ?? "");

  const updated = (Array.isArray(data) ? data[0] : data) as unknown as Payout | null;
  if (!updated) throw internal("approve_payout returned no payout");

  await recordAudit({
    actor: args.actor,
    action: "payout.approve",
    entityType: "payout",
    entityId: before.id,
    before: before as unknown as Json,
    after: { ...updated, note: args.note ?? null } as unknown as Json,
    ip: args.ip ?? null,
  });

  return updated;
}

/** Map `approve_payout` RPC error text to the HTTP contract (F2). */
function mapApprovePayoutError(message: string): Error {
  if (message.includes("PAYOUT_NOT_FOUND")) return notFound("Payout not found");
  if (message.includes("PAYOUT_NOT_REQUESTED")) {
    return conflict("Payout is not awaiting approval");
  }
  if (message.includes("PAYOUT_SELF_APPROVAL")) {
    return forbidden("A payout must be approved by a different user than the requester");
  }
  if (message.includes("PAYOUT_INSUFFICIENT_BALANCE")) {
    return badRequest("Insufficient available balance for this payout");
  }
  return new ApiError("provider_error", 502, "Failed to approve payout");
}

export interface RejectPayoutArgs {
  payoutId: string;
  actor: string;
  ip?: string | null;
  reason?: string | null;
}

/** Reject a requested payout. Idempotent when already rejected. */
export async function rejectPayout(args: RejectPayoutArgs): Promise<Payout> {
  const payout = await loadPayout(args.payoutId);

  if (payout.status === "rejected") return payout; // idempotent replay
  if (payout.status !== "requested") {
    throw conflict("Only a requested payout can be rejected", { status: payout.status });
  }

  const rejectedAt = new Date().toISOString();
  const { data, error } = await db()
    .from("payouts")
    .update({ status: "rejected", rejected_by: args.actor, rejected_at: rejectedAt })
    .eq("id", args.payoutId)
    .select()
    .single();
  if (error) throw internal("Failed to reject payout", { code: error.code });
  const rejected = data as unknown as Payout;

  await recordAudit({
    actor: args.actor,
    action: "payout.reject",
    entityType: "payout",
    entityId: payout.id,
    before: payout as unknown as Json,
    after: { ...rejected, reason: args.reason ?? null } as unknown as Json,
    ip: args.ip ?? null,
  });

  return rejected;
}
