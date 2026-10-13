/**
 * Wallet pool administration (SPEC §6 — wallets are a platform-wide pool).
 *
 * Wallet limits are integer paisa. `today_total` is engine-managed and never
 * edited here.
 */

import { z } from "zod";

import { recordAudit } from "@/lib/api/audit";
import { internal, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db/client";
import type { Json, Wallet } from "@/lib/db/types";
import { newId, PRE } from "@/lib/domain/ids";

const providerSchema = z.enum(["bkash", "nagad", "rocket"]);
const walletStatusSchema = z.enum(["active", "draining", "disabled"]);
const msisdnSchema = z.string().regex(/^01[3-9]\d{8}$/, "msisdn must be a BD mobile number");

const walletFieldsSchema = z
  .object({
    provider: providerSchema,
    msisdn: msisdnSchema,
    holder_name: z.string().trim().max(120).nullish(),
    daily_limit: z.number().int().nonnegative(),
    monthly_limit: z.number().int().nonnegative().nullish(),
    concurrency_cap: z.number().int().positive().max(1000),
    status: walletStatusSchema,
  })
  .strict();

export const createWalletSchema = walletFieldsSchema;

export const updateWalletSchema = walletFieldsSchema.partial().strict();

export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>;

/** List the wallet pool, newest first. */
export async function listWallets(): Promise<Wallet[]> {
  const { data, error } = await db()
    .from("wallets")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw internal("Failed to list wallets", { code: error.code });
  return (data as unknown as Wallet[] | null) ?? [];
}

export async function createWallet(
  input: CreateWalletInput,
  actor: string,
  ip: string | null,
): Promise<Wallet> {
  const id = newId(PRE.wallet);
  const { data, error } = await db()
    .from("wallets")
    .insert({
      id,
      provider: input.provider,
      msisdn: input.msisdn,
      holder_name: input.holder_name ?? null,
      daily_limit: input.daily_limit,
      monthly_limit: input.monthly_limit ?? null,
      concurrency_cap: input.concurrency_cap,
      status: input.status,
      today_total: 0,
      device_id: null,
      sim_slot: null,
      last_assigned_at: null,
    })
    .select()
    .single();
  if (error) throw internal("Failed to create wallet", { code: error.code });
  const wallet = data as unknown as Wallet;

  await recordAudit({
    actor,
    action: "wallet.create",
    entityType: "wallet",
    entityId: id,
    after: wallet as unknown as Json,
    ip,
  });
  return wallet;
}

export async function updateWallet(
  walletId: string,
  input: UpdateWalletInput,
  actor: string,
  ip: string | null,
): Promise<Wallet> {
  const { data: found, error } = await db()
    .from("wallets")
    .select("*")
    .eq("id", walletId)
    .maybeSingle();
  if (error) throw internal("Failed to load wallet", { code: error.code });
  const before = found as unknown as Wallet | null;
  if (!before) throw notFound("Wallet not found");

  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(patch).length === 0) return before;

  const { data, error: updateError } = await db()
    .from("wallets")
    .update(patch)
    .eq("id", walletId)
    .select()
    .single();
  if (updateError) throw internal("Failed to update wallet", { code: updateError.code });
  const wallet = data as unknown as Wallet;

  await recordAudit({
    actor,
    action: "wallet.update",
    entityType: "wallet",
    entityId: walletId,
    before: before as unknown as Json,
    after: wallet as unknown as Json,
    ip,
  });
  return wallet;
}
