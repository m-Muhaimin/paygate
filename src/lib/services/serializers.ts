/**
 * Response serialisers for the merchant-facing API (SPEC §7).
 *
 * Rows live in the domain as **integer paisa** (SPEC §1). The public API keeps
 * `amount` as paisa (so clients never do float math) and additionally exposes a
 * human-readable `*_bdt` string for UI display convenience.
 */

import type {
  Json,
  MatchedBy,
  Payment,
  PaymentStatus,
  PlanStatus,
  PricingPlan,
  Provider,
  ReviewReason,
} from "@/lib/db/types";
import { formatBdt } from "@/lib/domain/money";

/** The receiving wallet as the customer/merchant sees it (`number` = `msisdn`). */
export interface WalletView {
  provider: Provider;
  number: string;
  holder_name: string | null;
}

/** Shape of an embedded `wallets(...)` row returned by a PostgREST join. */
export interface WalletEmbed {
  provider: Provider;
  msisdn: string;
  holder_name: string | null;
}

/** Anything that carries the wallet fields needed for a `WalletView`. */
type WalletLike = { provider: Provider; msisdn: string; holder_name: string | null };

/** A payment row with an optional embedded wallet (from `select("*, wallets(...)")`). */
export type PaymentWithWallet = Payment & { wallets?: WalletEmbed | null };

/** Map a wallet row/embed to the public `wallet` object, or `null`. */
export function toWalletView(wallet: WalletLike | null | undefined): WalletView | null {
  if (!wallet) return null;
  return {
    provider: wallet.provider,
    number: wallet.msisdn,
    holder_name: wallet.holder_name ?? null,
  };
}

export interface SerializedPayment {
  id: string;
  merchant_id: string;
  plan_id: string | null;
  order_id: string | null;
  provider: Provider;
  /** integer paisa */
  amount: number;
  /** e.g. `Tk 1,200.00` */
  amount_bdt: string;
  /** integer paisa */
  fee_amount: number;
  fee_amount_bdt: string;
  /** integer paisa */
  net_amount: number;
  net_amount_bdt: string;
  currency: "BDT";
  reference: string;
  status: PaymentStatus;
  review_reason: ReviewReason | null;
  matched_by: MatchedBy | null;
  submitted_trx_id: string | null;
  wallet: WalletView | null;
  /** Hosted pay-page URL (populated on create). */
  pay_url: string | null;
  callback_url: string | null;
  metadata: Json | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
}

/**
 * Serialise a payment row. Pass `opts.wallet` when the wallet is known (create /
 * replayed payment) — otherwise an embedded `wallets` join is used when present.
 */
export function serializePayment(
  payment: PaymentWithWallet,
  opts?: { wallet?: WalletLike | null; payUrl?: string | null },
): SerializedPayment {
  const walletLike =
    opts?.wallet !== undefined ? opts.wallet : (payment.wallets ?? null);
  return {
    id: payment.id,
    merchant_id: payment.merchant_id,
    plan_id: payment.plan_id,
    order_id: payment.order_id,
    provider: payment.provider,
    amount: payment.amount,
    amount_bdt: formatBdt(payment.amount),
    fee_amount: payment.fee_amount,
    fee_amount_bdt: formatBdt(payment.fee_amount),
    net_amount: payment.net_amount,
    net_amount_bdt: formatBdt(payment.net_amount),
    currency: "BDT",
    reference: payment.reference,
    status: payment.status,
    review_reason: payment.review_reason,
    matched_by: payment.matched_by,
    submitted_trx_id: payment.submitted_trx_id,
    wallet: toWalletView(walletLike),
    pay_url: opts?.payUrl ?? null,
    callback_url: payment.callback_url,
    metadata: payment.metadata,
    expires_at: payment.expires_at,
    paid_at: payment.paid_at,
    created_at: payment.created_at,
  };
}

export interface SerializedPlan {
  id: string;
  merchant_id: string;
  name: string;
  /** integer paisa; `null` for an open-amount plan */
  amount: number | null;
  amount_bdt: string | null;
  currency: string;
  external_sku: string | null;
  version: number;
  status: PlanStatus;
  open_amount: boolean;
  min_amount: number | null;
  min_amount_bdt: string | null;
  max_amount: number | null;
  max_amount_bdt: string | null;
  created_at: string;
}

/** Serialise a pricing-plan row. */
export function serializePlan(plan: PricingPlan): SerializedPlan {
  return {
    id: plan.id,
    merchant_id: plan.merchant_id,
    name: plan.name,
    amount: plan.amount,
    amount_bdt: plan.amount === null ? null : formatBdt(plan.amount),
    currency: plan.currency,
    external_sku: plan.external_sku,
    version: plan.version,
    status: plan.status,
    open_amount: plan.open_amount,
    min_amount: plan.min_amount,
    min_amount_bdt: plan.min_amount === null ? null : formatBdt(plan.min_amount),
    max_amount: plan.max_amount,
    max_amount_bdt: plan.max_amount === null ? null : formatBdt(plan.max_amount),
    created_at: plan.created_at,
  };
}
