/**
 * Payout rails constants (SPEC §0).
 *
 * Money is integer paisa everywhere (BDT × 100). The minimum payout is
 * Tk 1,000 = 100,000 paisa; smaller balances simply accumulate.
 */

/** Minimum payout in paisa (Tk 1,000). SPEC §0. */
export const MIN_PAYOUT_PAISA = 100_000;

/**
 * Payout statuses that still reserve merchant balance.
 *
 * Reserved = `requested` only. A payout stops reserving the moment it is
 * approved: `approve_payout` debits the merchant ledger at approval time, so an
 * `approved` payout's funds are already out of the ledger and must NOT be
 * subtracted from available balance again (doing so double-counts the
 * reservation). `paid` / `rejected` never reserve.
 */
export const PENDING_PAYOUT_STATUSES = ["requested"] as const;
