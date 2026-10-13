/**
 * Money helpers. All amounts are integer paisa (BDT × 100) — never floats in
 * the database or in the domain layer (SPEC §1).
 */

/** Platform default fee: 5% per paid transaction, expressed in basis points. */
export const DEFAULT_FEE_RATE_BPS = 500;

/** Convert a BDT amount to integer paisa, rounding to the nearest paisa. */
export function paisaFromBdt(bdt: number): number {
  return Math.round(bdt * 100);
}

/** Convert integer paisa back to a BDT number (may be fractional). */
export function bdtFromPaisa(paisa: number): number {
  return paisa / 100;
}

const BDT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paisa as a full Tk amount, e.g. `Tk 1,200.00`. */
export function formatBdt(paisa: number): string {
  return `Tk ${BDT_FORMAT.format(paisa / 100)}`;
}

const BDT_COMPACT_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Format paisa as a compact Tk amount, e.g. `Tk 1.2K`, `Tk 3.4M`. */
export function formatBdtCompact(paisa: number): string {
  return `Tk ${BDT_COMPACT_FORMAT.format(paisa / 100)}`;
}

/** Fee amount in paisa for a given rate in basis points (nearest paisa). */
export function computeFee(amountPaisa: number, feeRateBps: number): number {
  return Math.round((amountPaisa * feeRateBps) / 10000);
}

/** Merchant net proceeds in paisa after deducting the fee. */
export function computeNet(amountPaisa: number, feeRateBps: number): number {
  return amountPaisa - computeFee(amountPaisa, feeRateBps);
}
