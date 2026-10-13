/**
 * Available merchant balance (SPEC §6).
 *
 * Thin delegation to the `merchant_balance` RPC (computed from the ledger:
 * payable credits − payout/refund debits). Returns integer paisa.
 */

import { merchantBalance } from "@/lib/db/rpc";

export async function availableBalance(merchantId: string): Promise<number> {
  return merchantBalance(merchantId);
}
