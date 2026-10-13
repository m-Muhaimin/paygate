/**
 * Versioned SMS parser (SPEC §1, §2, §9).
 *
 * Provider SMS wording drifts over time, so the parser is versioned: every
 * parsed row records `PARSER_VERSION` alongside it. Regexes live in per-provider
 * tables so a single provider's wording change does not break the others.
 *
 * Contract: given `{ provider?, sender, body }` return a `ParsedSms` for any
 * "you have received money" SMS, or `null` for anything else (outgoing transfers,
 * bills, airtime, marketing, unparseable junk).
 */

import { PROVIDERS, type Provider, isProvider } from "@/lib/domain/providers";
import { normalizeReference, isValidReference } from "@/lib/domain/reference";

/** Bump whenever parsing behaviour changes; persisted on each incoming txn. */
export const PARSER_VERSION = "2026-10-13.1";

export interface SmsPayload {
  /** Optional explicit provider; when omitted it is inferred from `sender`. */
  provider?: string | null;
  sender?: string | null;
  body: string;
}

export interface ParsedSms {
  trxId: string | null;
  amountPaisa: number;
  feePaisa: number;
  balanceAfterPaisa: number | null;
  refRaw: string | null;
  refNormalized: string | null;
  phone: string | null;
  /** Raw `at <date time>` fragment as it appeared in the SMS, or null. */
  occurredAt: string | null;
  parserVersion: string;
}

/** Per-provider regex table. A miss on any optional field yields null. */
export interface ProviderPattern {
  /** Positive "money received" signal (case-insensitive). */
  received: RegExp;
  trxId: RegExp;
  ref: RegExp;
  amounts: RegExp[];
  fee: RegExp;
  balance: RegExp;
  from: RegExp;
  time: RegExp;
}

const TIME = /\bat[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i;
const FROM = /\bfrom[:\s]+((?:\+?88)?0?1\d{9})\b/i;

// bKash: "You have received Tk 1,200.00 from 01712750278. Fee Tk 0.00.
//         Balance Tk 1,200.00. TrxID DJC9SZQV0J and Ref REF934P923 at 12/10/2026 15:24"
const BKASH_PATTERN: ProviderPattern = {
  received: /\breceived\b/i,
  trxId: /\bTrxID[:\s]+([A-Z0-9]{6,20})\b/i,
  ref: /\bRef[:\s]+([A-Za-z0-9]{6,20})\b/i,
  amounts: [/\breceived\s+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i],
  fee: /\bFee[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  balance: /\bBalance[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  from: FROM,
  time: TIME,
};

// Nagad variants: "Money Received. Tk 1,200.00 received from 01712750278.
//                 Ref: REF934P923. Fee Tk 0.00. Balance Tk 1,200.00. TrxID: DJC9SZQV0J"
// and "You have received Tk 1,200.00 from ..."
const NAGAD_PATTERN: ProviderPattern = {
  received: /\b(received|money\s+received)\b/i,
  trxId: /\b(?:TrxID|Trx\s*ID|TxnID|Txn\s*ID)[:\s]+([A-Z0-9]{6,20})\b/i,
  ref: /\b(?:Ref|Reference)[:\s]+([A-Za-z0-9]{6,20})\b/i,
  amounts: [
    /(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:received|has\s+been\s+received|credited)/i,
    /\breceived\s+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  ],
  fee: /\b(?:Fee|Charge)[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  balance: /\b(?:Balance|Current\s+Balance)[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  from: FROM,
  time: TIME,
};

// Rocket (DBBL): "You have received Tk 1,200.00 from 01712750278.
//                Fee Tk 0.00. Balance Tk 1,200.00. TxnID DJC9SZQV0J Ref REF934P923"
const ROCKET_PATTERN: ProviderPattern = {
  received: /\b(received|credited)\b/i,
  trxId: /\b(?:TrxID|TxnID|Txn\s*ID)[:\s]+([A-Z0-9]{6,20})\b/i,
  ref: /\b(?:Ref|Reference)[:\s]+([A-Za-z0-9]{6,20})\b/i,
  amounts: [
    /\breceived\s+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:received|credited)/i,
  ],
  fee: /\bFee[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  balance: /\bBalance[:\s]+(?:Tk|BDT|৳)\s*([\d,]+(?:\.\d{1,2})?)/i,
  from: FROM,
  time: TIME,
};

export const PROVIDER_PATTERNS: Record<Provider, ProviderPattern> = {
  bkash: BKASH_PATTERN,
  nagad: NAGAD_PATTERN,
  rocket: ROCKET_PATTERN,
};

/** Parse a "1,200.00" amount string into integer paisa. */
export function parseAmountToPaisa(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

const SENDER_DIGITS = /(?:\+?88)?0?1\d{9}/;

/** Normalise a BD phone to 11 digits (leading 0, no country code). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(SENDER_DIGITS);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, "");
  return digits.slice(-11);
}

/** Infer the provider from the SMS sender id (SPEC §6 `PROVIDERS[*].senderIds`). */
export function detectProvider(
  sender: string | null | undefined,
  explicit?: string | null,
): Provider | null {
  if (explicit && isProvider(explicit)) return explicit;
  if (!sender) return null;
  const upper = sender.toUpperCase();
  for (const key of Object.keys(PROVIDERS) as Provider[]) {
    for (const senderId of PROVIDERS[key].senderIds) {
      if (upper.includes(senderId.toUpperCase())) return key;
    }
  }
  return null;
}

/**
 * Best-effort TrxID extraction that does not require the rest of the message to
 * parse. Used by ingest to persist flagged "unparseable" rows for review.
 */
export function extractTrxId(body: string): string | null {
  const m = body.match(/\b(?:TrxID|TxnID|Trx\s*ID|Txn\s*ID)[:\s]+([A-Z0-9]{6,20})\b/i);
  return m && m[1] ? m[1].toUpperCase() : null;
}

function firstMatch(patterns: RegExp[], body: string): string | null {
  for (const re of patterns) {
    const m = body.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Parse a received-money SMS.
 *
 * Returns `null` when the sender does not map to a known provider, the message
 * is not a "received money" message, or an amount/fee cannot be valued.
 * A parseable money message with a *malformed* reference keeps `refRaw` and
 * sets `refNormalized = null` (SPEC §2: the token goes to the unmatched pool).
 */
export function parseSms(payload: SmsPayload): ParsedSms | null {
  const body = payload.body ?? "";
  const provider = detectProvider(payload.sender, payload.provider);
  if (!provider) return null;

  const patterns = PROVIDER_PATTERNS[provider];
  if (!patterns.received.test(body)) return null;

  const amountRaw = firstMatch(patterns.amounts, body);
  const feeRaw = firstMatch([patterns.fee], body);
  const amountPaisa = amountRaw ? parseAmountToPaisa(amountRaw) : null;
  const feePaisa = feeRaw ? parseAmountToPaisa(feeRaw) : null;
  if (amountPaisa === null || feePaisa === null) return null;

  const balanceRaw = firstMatch([patterns.balance], body);
  const trxMatch = body.match(patterns.trxId);
  const refMatch = body.match(patterns.ref);
  const fromMatch = body.match(patterns.from);
  const timeMatch = body.match(patterns.time);

  let refRaw: string | null = null;
  let refNormalized: string | null = null;
  if (refMatch && refMatch[1]) {
    refRaw = refMatch[1];
    const candidate = normalizeReference(refRaw);
    refNormalized = isValidReference(candidate) ? candidate : null;
  }

  return {
    trxId: trxMatch && trxMatch[1] ? trxMatch[1].toUpperCase() : null,
    amountPaisa,
    feePaisa,
    balanceAfterPaisa: balanceRaw ? parseAmountToPaisa(balanceRaw) : null,
    refRaw,
    refNormalized,
    phone: fromMatch ? normalizePhone(fromMatch[1]) : null,
    occurredAt: timeMatch ? timeMatch[1] : null,
    parserVersion: PARSER_VERSION,
  };
}
