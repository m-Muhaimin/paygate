/**
 * Webhook signing helpers (SPEC §8): re-export the canonical Web Crypto
 * implementations so webhook code has one import path. The header is
 * `PayGate-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>`.
 */

export {
  buildSignatureHeader,
  signWebhook,
  verifySignatureHeader,
} from "@/lib/api/crypto";
