/**
 * Double-entry ledger posting (SPEC §1, §6).
 *
 * For a paid payment the money flow is recorded as one balanced entry group:
 *   debit  payin            amount
 *   credit fee              fee_amount
 *   credit merchant_payable net_amount
 *
 * `amount = fee_amount + net_amount`, so the group nets to zero. Ledger rows are
 * immutable; balances are always derived (never stored).
 */

import { db } from "@/lib/db/client";
import { internal } from "@/lib/api/errors";
import { newId } from "@/lib/domain/ids";
import type { Payment } from "@/lib/db/types";

interface LedgerRow {
  id: string;
  merchant_id: string;
  payment_id: string;
  account: "payin" | "fee" | "merchant_payable";
  direction: "debit" | "credit";
  amount: number;
  entry_group: string;
}

/**
 * Post the three balanced ledger entries for a paid payment.
 *
 * Idempotent per payment: `ledger_entries` carries a unique constraint on
 * `(payment_id, account)`, so a concurrent/repeat post for the same payment is a
 * no-op (ignored duplicate) rather than a duplicate credit.
 */
export async function postPaymentPaid(payment: Payment): Promise<void> {
  const entryGroup = payment.id;

  const rows: LedgerRow[] = [
    {
      id: newId("led_"),
      merchant_id: payment.merchant_id,
      payment_id: payment.id,
      account: "payin",
      direction: "debit",
      amount: payment.amount,
      entry_group: entryGroup,
    },
    {
      id: newId("led_"),
      merchant_id: payment.merchant_id,
      payment_id: payment.id,
      account: "fee",
      direction: "credit",
      amount: payment.fee_amount,
      entry_group: entryGroup,
    },
    {
      id: newId("led_"),
      merchant_id: payment.merchant_id,
      payment_id: payment.id,
      account: "merchant_payable",
      direction: "credit",
      amount: payment.net_amount,
      entry_group: entryGroup,
    },
  ];

  // `ledger_entries.amount` is `check (amount > 0)`, so a zero-value leg (e.g. a
  // 0-bps fee) is omitted rather than inserted; the group stays balanced because
  // a zero leg contributes nothing to either side. A wholly-zero payment (amount
  // 0) posts nothing.
  const legs = rows.filter((r) => r.amount > 0);
  if (legs.length === 0) return;

  const { error } = await db()
    .from("ledger_entries")
    .upsert(legs, { onConflict: "payment_id,account", ignoreDuplicates: true });
  if (error) throw internal("ledger_post_failed", { code: error.code });
}
