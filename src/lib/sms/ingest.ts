/**
 * SMS ingest service (SPEC §7 `POST /v1/sms/webhook` body).
 *
 * Pipeline: dedupe → resolve receiving wallet → parse → encrypt raw → insert
 * `incoming_txns` with flags → hand off to the matching engine.
 *
 * The device is authenticated by the route; its id is passed in so a txn can be
 * pinned to the wallet seated in that device's SIM slot (`wallets.device_id` +
 * `sim_slot`), which is the only trustworthy way to know *which* wallet received
 * the money.
 */

import { db } from "@/lib/db/client";
import { internal } from "@/lib/api/errors";
import type { Provider } from "@/lib/domain/providers";
import { detectProvider, extractTrxId, parseSms } from "./parser";
import { matchIncomingTxn, type MatchInput } from "@/lib/matching/engine";

export interface SmsIngestPayload {
  sender: string;
  body: string;
  client_msg_id: string;
  received_at?: string;
  sim_slot?: number;
  ref_hint?: string;
  parser_version?: string;
  /** Device id from `authenticateDevice`; used to resolve the receiving wallet. */
  device_id?: string;
}

export type IngestResult = "stored" | "ignored" | "duplicate" | "unparseable";

/** AES-256-GCM over Web Crypto; output `base64(iv ‖ ciphertext ‖ tag)`. */
async function deriveAesKey(keyStr: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    raw = new Uint8Array(keyStr.match(/../g)!.map((h) => parseInt(h, 16)));
  } else {
    // Any other secret material (incl. base64) is strengthened to 256 bits.
    raw = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyStr)));
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
}

async function encryptRaw(raw: string, keyStr: string): Promise<string> {
  const key = await deriveAesKey(keyStr);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(raw)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return Buffer.from(out).toString("base64");
}

async function resolveWalletId(
  provider: Provider,
  deviceId: string | undefined,
  simSlot: number | undefined,
): Promise<string | null> {
  if (!deviceId) return null;
  const supabase = db();
  const { data, error } = await supabase
    .from("wallets")
    .select("id,sim_slot,provider")
    .eq("device_id", deviceId)
    .eq("provider", provider);
  if (error) throw internal("wallet_resolve_failed", { code: error.code });
  const rows = (data ?? []) as Array<{ id: string; sim_slot: number | null; provider: Provider }>;
  if (rows.length === 0) return null;
  if (simSlot !== undefined && simSlot !== null) {
    const exact = rows.find((r) => r.sim_slot === simSlot);
    if (exact) return exact.id;
  }
  return rows[0].id;
}

/**
 * Ingest one device SMS.
 *
 * Returns:
 * - `duplicate` — `client_msg_id` (or the `(provider,trx_id,wallet)` PK) already stored;
 * - `ignored`   — authenticated device has no wallet in the reported SIM slot;
 * - `unparseable` — not a received-money SMS (a flagged row is stored when a TrxID
 *   could still be extracted, so operators can inspect it);
 * - `stored`    — persisted (and matching attempted).
 */
export async function ingestSms(payload: SmsIngestPayload): Promise<IngestResult> {
  const supabase = db();

  // 1. Dedupe on client_msg_id (idempotent replay from the device queue).
  if (payload.client_msg_id) {
    const { data: existing, error } = await supabase
      .from("incoming_txns")
      .select("trx_id")
      .eq("client_msg_id", payload.client_msg_id)
      .limit(1);
    if (error) throw internal("ingest_dedupe_failed", { code: error.code });
    if ((existing ?? []).length > 0) return "duplicate";
  }

  const provider = detectProvider(payload.sender);
  if (!provider) return "unparseable";

  const parsed = parseSms({ sender: payload.sender, body: payload.body });
  const trxId = parsed?.trxId ?? extractTrxId(payload.body);

  // 2. Resolve the receiving wallet from the device + SIM slot.
  const walletId = await resolveWalletId(provider, payload.device_id, payload.sim_slot);
  if (!walletId) {
    // Unparseable with nowhere to store it still reports the real reason.
    return parsed ? "ignored" : "unparseable";
  }

  // Without a TrxID the row cannot be keyed (PK `(provider, trx_id, wallet_id)`).
  if (!trxId) return "unparseable";

  // 3. Encrypt the raw SMS body (best-effort; absent key → flag only).
  const key = process.env.SMS_ENCRYPTION_KEY;
  let encryptedRaw: string | null = null;
  let rawUnavailable = false;
  if (key) {
    try {
      encryptedRaw = await encryptRaw(payload.body, key);
    } catch {
      rawUnavailable = true;
    }
  } else {
    rawUnavailable = true;
  }

  const receivedAt = payload.received_at ?? new Date().toISOString();

  // 4a. Unparseable: persist a flagged row so operators can inspect it.
  if (!parsed) {
    const flags = ["unparseable", ...(rawUnavailable ? ["raw_unavailable"] : [])];
    const inserted = await supabase.from("incoming_txns").insert({
      provider,
      trx_id: trxId,
      wallet_id: walletId,
      amount: 0,
      balance_after: null,
      ref_raw: null,
      ref_normalized: null,
      raw: encryptedRaw,
      client_msg_id: payload.client_msg_id,
      sim_slot: payload.sim_slot ?? null,
      claimed_payment_id: null,
      flags,
      received_at: receivedAt,
    });
    if (inserted.error) {
      if (inserted.error.code === "23505") return "duplicate";
      throw internal("ingest_insert_failed", { code: inserted.error.code });
    }
    return "unparseable";
  }

  // 4b. Parseable received-money SMS.
  const flags: string[] = [];
  if (rawUnavailable) flags.push("raw_unavailable");
  if (parsed.refRaw !== null && parsed.refNormalized === null) flags.push("ref_missing");

  const insertRes = await supabase.from("incoming_txns").insert({
    provider,
    trx_id: trxId,
    wallet_id: walletId,
    amount: parsed.amountPaisa,
    balance_after: parsed.balanceAfterPaisa,
    ref_raw: parsed.refRaw,
    ref_normalized: parsed.refNormalized,
    raw: encryptedRaw,
    client_msg_id: payload.client_msg_id,
    sim_slot: payload.sim_slot ?? null,
    claimed_payment_id: null,
    flags,
    received_at: receivedAt,
  });

  if (insertRes.error) {
    if (insertRes.error.code === "23505") return "duplicate";
    throw internal("ingest_insert_failed", { code: insertRes.error.code });
  }

  // 5. Attempt matching. Matching failures must not lose the stored txn.
  const matchInput: MatchInput = {
    provider,
    trx_id: trxId,
    wallet_id: walletId,
    amount: parsed.amountPaisa,
    balance_after: parsed.balanceAfterPaisa,
    ref_normalized: parsed.refNormalized,
    parser_version: parsed.parserVersion,
  };
  try {
    await matchIncomingTxn(matchInput);
  } catch {
    // Swallowed by design: the txn is durably stored and can be re-matched.
  }

  return "stored";
}
