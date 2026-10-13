/**
 * Pending-payment concurrency helper (SPEC §5).
 *
 * The `assign_wallet` RPC already enforces the per-wallet concurrency cap; this
 * helper exposes the same count for callers that need it explicitly (e.g. an
 * operator view or a pre-flight check before requesting a wallet).
 */

import { db } from "@/lib/db/client";
import type { Provider } from "@/lib/domain/providers";

const PENDING_STATUSES = ["created", "awaiting_payment"] as const;

/** Count payments still awaiting funds, optionally scoped to one wallet. */
export async function pendingPaymentCount(walletId: string): Promise<number> {
  const { count, error } = await db()
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("wallet_id", walletId)
    .in("status", [...PENDING_STATUSES]);
  if (error) return 0;
  return count ?? 0;
}

/** Count non-draining active wallets for a provider (fleet capacity view). */
export async function activeWalletCount(provider: Provider): Promise<number> {
  const { count, error } = await db()
    .from("wallets")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("status", "active");
  if (error) return 0;
  return count ?? 0;
}
