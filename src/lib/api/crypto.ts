/**
 * Cryptography helpers built on the Web Crypto API (`globalThis.crypto`), which
 * is available in Node 20+, Edge runtime and browsers — no Node `crypto` import
 * so the same code runs in Route Handlers and middleware.
 *
 * Hash choice: secrets hashed here (device tokens, API keys, webhook secrets)
 * are always 256-bit random values minted by `generateToken`. For inputs with
 * that much entropy, an unsalted SHA-256 hex digest is safe — brute force is
 * infeasible and salting would only complicate deterministic lookups. Password-
 * like low-entropy material must NOT be hashed with this helper (it is not used
 * for user passwords; Supabase Auth owns those).
 */

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** SHA-256 hex digest of a secret (64 lowercase hex chars). */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return toHex(digest);
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Constant-time verification of a secret against a stored `hashSecret` digest. */
export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  const candidate = await hashSecret(secret);
  return timingSafeEqualHex(candidate, hash);
}

/** Generate a random token as hex. Default 32 bytes = 256 bits (64 hex chars). */
export function generateToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(signature);
}

/** `v1` signature: HMAC-SHA256(secret, `${t}.${rawBody}`) as lowercase hex. */
export function signWebhook(secret: string, t: number, rawBody: string): Promise<string> {
  return hmacSha256Hex(secret, `${t}.${rawBody}`);
}

/** Build the `PayGate-Signature` header for a payload using the current time. */
export async function buildSignatureHeader(secret: string, rawBody: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const v1 = await signWebhook(secret, t, rawBody);
  return `t=${t},v1=${v1}`;
}

function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  if (!header) return null;
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) t = parsed;
    } else if (key === "v1") {
      v1 = value;
    }
  }
  if (t === null || v1 === null || v1.length === 0) return null;
  return { t, v1 };
}

/**
 * Verify a `t=<unix>,v1=<hex>` signature header against the raw body, rejecting
 * timestamps more than `toleranceSec` away from now (default 300s = 5 minutes).
 */
export async function verifySignatureHeader(
  secret: string,
  header: string,
  rawBody: string,
  toleranceSec = 300,
): Promise<boolean> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > toleranceSec) return false;

  const expected = await signWebhook(secret, parsed.t, rawBody);
  return timingSafeEqualHex(expected, parsed.v1);
}
