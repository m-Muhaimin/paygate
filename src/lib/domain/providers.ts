/**
 * Provider metadata for the three supported Bangladeshi wallet rails.
 */

export type Provider = "bkash" | "nagad" | "rocket";

export interface ProviderMeta {
  id: Provider;
  /** Human label for UI. */
  label: string;
  /** Brand colour (SPEC §10 provider dots). */
  colorHex: string;
  /** SMS sender ids accepted by the device-side allowlist. */
  senderIds: string[];
  /**
   * `echo` — the provider's SMS echoes the customer-supplied reference.
   * `trxid_only` — the SMS carries only a TrxID; reference matching is not
   * possible and the TrxID fallback is authoritative for that provider.
   */
  referenceMode: "echo" | "trxid_only";
  /** Max characters accepted in the reference field of a payment request. */
  refFieldMaxLen: number;
}

export const PROVIDERS: Record<Provider, ProviderMeta> = {
  bkash: {
    id: "bkash",
    label: "bKash",
    colorHex: "#E2136E",
    senderIds: ["bKash"],
    referenceMode: "echo",
    refFieldMaxLen: 20,
  },
  nagad: {
    id: "nagad",
    label: "Nagad",
    colorHex: "#F6921E",
    senderIds: ["NAGAD"],
    referenceMode: "echo",
    refFieldMaxLen: 20,
  },
  rocket: {
    id: "rocket",
    label: "Rocket",
    colorHex: "#8C3494",
    senderIds: ["16216"],
    referenceMode: "echo",
    refFieldMaxLen: 20,
  },
};

/** Narrow an unknown value to a supported provider id. */
export function isProvider(x: unknown): x is Provider {
  return x === "bkash" || x === "nagad" || x === "rocket";
}
