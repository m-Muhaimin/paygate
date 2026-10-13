/**
 * Typed wrappers over the Postgres helper functions defined in
 * `supabase/migrations/20261013000003_functions.sql` (`.reports/db.md` §3).
 *
 * All three are `SECURITY DEFINER` and granted to `service_role` only, so they must
 * be called through the privileged `db()` client (never `dbAsUser`). Supabase errors
 * are normalised to `ApiError` here — callers never see a raw PostgREST error.
 */

import { internal } from "@/lib/api/errors";
import type { Provider, Wallet } from "@/lib/db/types";

import { db } from "./client";

/**
 * `assign_wallet(p_provider, p_merchant_id)` — atomically picks and stamps the
 * least-recently-assigned healthy active wallet for a provider.
 *
 * Returns `null` when no wallet qualifies; the caller (wallet-assignment service)
 * maps that to `503 no_wallet_available` (SPEC §5). Throws on a genuine RPC error.
 */
export async function assignWallet(
  provider: Provider,
  merchantId: string,
): Promise<Wallet | null> {
  const { data, error } = await db().rpc("assign_wallet", {
    p_provider: provider,
    p_merchant_id: merchantId,
  });
  if (error) {
    throw internal("assign_wallet failed", { rpc: "assign_wallet", code: error.code });
  }
  return (data as unknown as Wallet | null) ?? null;
}

export interface ClaimIncomingTxnArgs {
  provider: Provider;
  trxId: string;
  walletId: string;
  paymentId: string;
}

/**
 * `claim_incoming_txn(p_provider, p_trx_id, p_wallet_id, p_payment_id)` — atomic
 * single-use claim of an unclaimed incoming txn. `true` only for the call that won
 * the race (SPEC §4).
 */
export async function claimIncomingTxn(args: ClaimIncomingTxnArgs): Promise<boolean> {
  const { data, error } = await db().rpc("claim_incoming_txn", {
    p_provider: args.provider,
    p_trx_id: args.trxId,
    p_wallet_id: args.walletId,
    p_payment_id: args.paymentId,
  });
  if (error) {
    throw internal("claim_incoming_txn failed", {
      rpc: "claim_incoming_txn",
      code: error.code,
    });
  }
  return data === true;
}

/**
 * `merchant_balance(p_merchant_id)` — available balance in integer paisa, computed
 * from the ledger (payable credits − payout/refund debits). Returns `0` for a
 * merchant with no ledger entries.
 */
export async function merchantBalance(merchantId: string): Promise<number> {
  const { data, error } = await db().rpc("merchant_balance", {
    p_merchant_id: merchantId,
  });
  if (error) {
    throw internal("merchant_balance failed", { rpc: "merchant_balance", code: error.code });
  }
  const value = Number(data ?? 0);
  return Number.isFinite(value) ? value : 0;
}
