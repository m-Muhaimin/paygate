/**
 * Prefixed entity identifiers.
 *
 * Every persisted entity uses a human-scannable, collision-resistant text id of
 * the form `<prefix><random>`. The random part is derived from a UUIDv4 with the
 * hyphens stripped, truncated to 24 hex chars (96 bits of entropy) — ample for
 * the id volumes this platform will ever see while keeping keys short.
 */

/** Canonical id prefixes, one per table/entity type (see SPEC §1). */
export const PRE = {
  merchant: "mer_",
  plan: "plan_",
  payment: "pay_",
  wallet: "wal_",
  device: "dev_",
  incomingTxn: "itx_",
  ledger: "led_",
  settlement: "set_",
  payout: "po_",
  webhookDelivery: "whd_",
  audit: "aud_",
  event: "evt_",
  apiKey: "key_",
} as const;

/** Union of all known id prefixes. */
export type Prefix = (typeof PRE)[keyof typeof PRE];

const ID_RANDOM_HEX_LENGTH = 24;

/** Build a new prefixed id, e.g. `newId(PRE.payment)` -> `pay_1f9c...`. */
export function newId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}${hex.slice(0, ID_RANDOM_HEX_LENGTH)}`;
}
