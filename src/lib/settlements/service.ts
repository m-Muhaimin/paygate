/**
 * Settlement + balance read models (SPEC §6, §7).
 *
 * Amounts are integer paisa. Balances are always derived from the ledger / paid
 * payments — never stored — so there is a single source of truth for money.
 */

import { internal } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import { merchantBalance } from "@/lib/db/rpc";
import type { Settlement } from "@/lib/db/types";
import { PENDING_PAYOUT_STATUSES } from "@/lib/payouts/constants";

import { settlementsToCsv } from "./csv";

export interface SettlementFilters {
  periodStart?: string;
  periodEnd?: string;
  limit?: number;
}

/** List a merchant's settlement statements, newest period first. */
export async function listSettlements(
  merchantId: string,
  filters: SettlementFilters = {},
): Promise<Settlement[]> {
  let query = db().from("settlements").select("*").eq("merchant_id", merchantId);
  if (filters.periodStart) query = query.gte("period_start", filters.periodStart);
  if (filters.periodEnd) query = query.lte("period_end", filters.periodEnd);
  const { data, error } = await query
    .order("period_start", { ascending: false })
    .limit(filters.limit ?? 200);
  if (error) throw internal("Failed to list settlements", { code: error.code });
  return (data as unknown as Settlement[] | null) ?? [];
}

/** Render a merchant's settlements as a CSV document. */
export async function exportSettlementsCsv(
  merchantId: string,
  filters: SettlementFilters = {},
): Promise<string> {
  const rows = await listSettlements(merchantId, filters);
  return settlementsToCsv(rows);
}

/** `GET /v1/balance` payload. All amounts integer paisa; currency is always BDT. */
export interface BalanceSummary {
  available: number;
  pending_payouts: number;
  lifetime_gross: number;
  lifetime_fees: number;
  lifetime_net: number;
  currency: "BDT";
}

interface PaidPaymentRow {
  amount: number | null;
  fee_amount: number | null;
  net_amount: number | null;
}

interface PayoutAmountRow {
  amount: number | null;
}

/**
 * Compute the merchant balance summary:
 *   available       — ledger balance minus payouts still reserving funds
 *                     (`requested` only; `approved` payouts are already
 *                     debited from the ledger, so counting them again would
 *                     double-subtract)
 *   pending_payouts — sum of `requested` payouts
 *   lifetime_*      — paid payments only
 */
export async function getBalanceSummary(merchantId: string): Promise<BalanceSummary> {
  const ledgerBalance = await merchantBalance(merchantId);

  const { data: paymentRows, error: paymentError } = await db()
    .from("payments")
    .select("amount, fee_amount, net_amount")
    .eq("merchant_id", merchantId)
    .eq("status", "paid");
  if (paymentError) throw internal("Failed to compute balance", { code: paymentError.code });
  const paid = (paymentRows as unknown as PaidPaymentRow[] | null) ?? [];
  const lifetimeGross = paid.reduce((t, p) => t + (p.amount ?? 0), 0);
  const lifetimeFees = paid.reduce((t, p) => t + (p.fee_amount ?? 0), 0);
  const lifetimeNet = paid.reduce((t, p) => t + (p.net_amount ?? 0), 0);

  const { data: payoutRows, error: payoutError } = await db()
    .from("payouts")
    .select("amount")
    .eq("merchant_id", merchantId)
    .in("status", [...PENDING_PAYOUT_STATUSES]);
  if (payoutError) throw internal("Failed to compute balance", { code: payoutError.code });
  const pendingPayouts = ((payoutRows as unknown as PayoutAmountRow[] | null) ?? []).reduce(
    (t, p) => t + (p.amount ?? 0),
    0,
  );

  return {
    available: ledgerBalance - pendingPayouts,
    pending_payouts: pendingPayouts,
    lifetime_gross: lifetimeGross,
    lifetime_fees: lifetimeFees,
    lifetime_net: lifetimeNet,
    currency: "BDT",
  };
}
