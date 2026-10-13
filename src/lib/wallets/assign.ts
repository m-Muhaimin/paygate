/**
 * Wallet assignment wrapper (SPEC §5).
 *
 * Delegates the atomic pick-and-stamp to the `assign_wallet` RPC (heartbeat
 * freshness, limit headroom, concurrency cap, least-recently-assigned), maps an
 * empty result to `503 no_wallet_available`, then applies the auto-drain rule
 * (a wallet past 80% of a limit stops taking new payments).
 */

import { assignWallet as rpcAssignWallet } from "@/lib/db/rpc";
import { db } from "@/lib/db/client";
import { noWalletAvailable } from "@/lib/api/errors";
import type { Provider, Wallet } from "@/lib/db/types";

/** Fraction of a limit at which a wallet starts draining. */
export const DRAIN_THRESHOLD = 0.8;

/** True when the wallet has crossed 80% of its daily or monthly limit. */
export function shouldAutoDrain(wallet: Pick<Wallet, "today_total" | "daily_limit" | "monthly_limit">): boolean {
  if (wallet.daily_limit > 0 && wallet.today_total >= wallet.daily_limit * DRAIN_THRESHOLD) {
    return true;
  }
  if (wallet.monthly_limit && wallet.monthly_limit > 0) {
    return wallet.today_total >= wallet.monthly_limit * DRAIN_THRESHOLD;
  }
  return false;
}

/**
 * Assign a wallet for a new payment.
 *
 * @throws ApiError `503 no_wallet_available` when no healthy wallet qualifies.
 */
export async function assignWallet(provider: Provider, merchantId: string): Promise<Wallet> {
  const wallet = await rpcAssignWallet(provider, merchantId);
  if (!wallet) throw noWalletAvailable();

  if (wallet.status === "active" && shouldAutoDrain(wallet)) {
    try {
      await db().from("wallets").update({ status: "draining" }).eq("id", wallet.id);
      wallet.status = "draining";
    } catch {
      // Draining is advisory here; the DB remains the source of truth.
    }
  }

  return wallet;
}
