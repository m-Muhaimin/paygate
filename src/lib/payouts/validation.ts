/**
 * Payout request validation (SPEC §0, §7).
 *
 * Pure functions so the money rules are unit-testable without a database. All
 * amounts are integer paisa; the minimum threshold is Tk 1,000 (100,000 paisa).
 */

import { z } from "zod";

import { badRequest } from "@/lib/api/errors";

import { MIN_PAYOUT_PAISA } from "./constants";

const providerSchema = z.enum(["bkash", "nagad", "rocket"]);

/** `payouts.destination` — bank account or MFS wallet (SPEC §6). */
export const payoutDestinationSchema = z
  .object({
    account_no: z.string().trim().min(1).max(64).optional(),
    holder: z.string().trim().min(1).max(120).optional(),
    bank_name: z.string().trim().min(1).max(120).optional(),
    provider: providerSchema.optional(),
  })
  .strict();

export const payoutRequestSchema = z
  .object({
    amount: z.number().int().positive(),
    rail: z.enum(["bank", "mfs"]),
    destination: payoutDestinationSchema.optional(),
  })
  .strict();

export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;

/**
 * Assert a requested payout is well-formed and affordable.
 *
 * @throws `badRequest()` (400) when the amount is not a positive integer, is
 *   below the Tk 1,000 minimum, or exceeds the merchant's available balance.
 */
export function validatePayoutAmount(amount: number, available: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw badRequest("amount must be a positive integer in paisa");
  }
  if (amount < MIN_PAYOUT_PAISA) {
    throw badRequest(`Minimum payout is Tk 1,000 (${MIN_PAYOUT_PAISA} paisa)`, {
      min_payout_paisa: MIN_PAYOUT_PAISA,
    });
  }
  if (amount > available) {
    throw badRequest("Insufficient available balance for this payout", {
      available,
      requested: amount,
    });
  }
}
