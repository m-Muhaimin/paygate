# Core shared domain library + test harness — report

**Task:** core shared TypeScript domain lib + vitest harness (PayGate SaaS)
**Repo:** `W:\pay_gate\paygate-saas`
**Status:** complete — `npx vitest run` 46/46 passing, `npx tsc --noEmit` 0 errors.
**Commits:** none. The repo has no commits yet and committing was not requested; work is staged in the working tree only.

## 1. Test harness

- devDependencies added: `vitest@^3.2.7`, `@vitest/coverage-v8@^3.2.7`.
  (vitest 5 was rejected by npm — it requires `@types/node ^22 || >=24` and the repo pins `@types/node ^20`; vitest 3 is the correct compatible line. No change to `@types/node`.)
- Scripts appended to `package.json`: `"test": "vitest"`, `"test:run": "vitest run"`, `"typecheck": "tsc --noEmit"`.
- `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]`, alias `@` -> `./src` (mirrors tsconfig `paths`). `npm install` run once.

## 2. `src/lib/domain/ids.ts`

```ts
export const PRE: {
  merchant: "mer_"; plan: "plan_"; payment: "pay_"; wallet: "wal_";
  device: "dev_"; incomingTxn: "itx_"; ledger: "led_"; settlement: "set_";
  payout: "po_"; webhookDelivery: "whd_"; audit: "aud_"; event: "evt_"; apiKey: "key_";
} as const;
export type Prefix = (typeof PRE)[keyof typeof PRE];
export function newId(prefix: string): string; // `${prefix}${uuidNoDashes.slice(0,24)}`
```
Random part = `crypto.randomUUID()` with dashes stripped, **sliced to 24 hex chars (96 bits)** — slice length was unspecified in the brief.

## 3. `src/lib/domain/money.ts`

```ts
export const DEFAULT_FEE_RATE_BPS = 500;
export function paisaFromBdt(bdt: number): number;                 // round(bdt*100)
export function bdtFromPaisa(paisa: number): number;               // paisa/100
export function formatBdt(paisa: number): string;                  // "Tk 1,200.00"
export function formatBdtCompact(paisa: number): string;           // "Tk 1.2K" / "Tk 1M"
export function computeFee(amountPaisa: number, feeRateBps: number): number; // round(a*bps/10000)
export function computeNet(amountPaisa: number, feeRateBps: number): number; // amount - fee
```

## 4. `src/lib/domain/reference.ts` — canonical reference module

```ts
export const REFERENCE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31
export const REFERENCE_LENGTH = 8;
export const LOOKALIKE_CHARS = "0O1IL";                 // exported for tests/parsers
export function generateReference(): string;            // 7 random charset chars + 1 check
export function normalizeReference(input: string): string;
export function isValidReference(input: string): boolean;
export function suggestNearMatch(normalized: string, candidates: string[]): string | null;
```
- Check char: `charset[Σ_{i=0..6}(charsetIndex(c_i)+1)*(i+1) % 31]`.
- Random indices use rejection sampling (no modulo bias).
- `suggestNearMatch` returns the unique candidate at edit distance 1 (substitution or single insert/delete), else `null`; an exact-match candidate is not a suggestion, and ties return `null` (never auto-applied).

## 5. `src/lib/domain/providers.ts`

```ts
export type Provider = "bkash" | "nagad" | "rocket";
export interface ProviderMeta {
  id: Provider; label: string; colorHex: string; senderIds: string[];
  referenceMode: "echo" | "trxid_only"; refFieldMaxLen: number;
}
export const PROVIDERS: Record<Provider, ProviderMeta>;
export function isProvider(x: unknown): x is Provider;
```
Values: bKash `#E2136E` `["bKash"]`, Nagad `#F6921E` `["NAGAD"]`, Rocket `#8C3494` `["16216"]`. All `referenceMode: "echo"`, `refFieldMaxLen: 20` (assumptions — see §10).

## 6. `src/lib/api/errors.ts`

```ts
export class ApiError extends Error {
  readonly code: string; readonly status: number; readonly details?: unknown;
  constructor(code: string, status: number, message: string, details?: unknown);
}
export function badRequest(message?, details?): ApiError;        // 400 bad_request
export function unauthorized(message?, details?): ApiError;      // 401 unauthorized
export function forbidden(message?, details?): ApiError;         // 403 forbidden
export function notFound(message?, details?): ApiError;          // 404 not_found
export function conflict(message?, details?): ApiError;          // 409 conflict
export function unprocessable(message?, details?): ApiError;     // 422 unprocessable
export function tooManyRequests(message?, details?): ApiError;   // 429 too_many_requests
export function noWalletAvailable(message?, details?): ApiError; // 503 no_wallet_available
export function internal(message?, details?): ApiError;          // 500 internal_error
```

## 7. `src/lib/api/http.ts`

```ts
export function json(data: unknown, init?: ResponseInit): Response;
export function getRequestId(req: Request): string;              // x-request-id or randomUUID()
export type LogLevel = "debug" | "info" | "warn" | "error";
export function logStructured(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
export function errorResponse(err: unknown, requestId: string): Response; // { error: { code, message, request_id, details? } }
export type RequestHandler = (req: Request, requestId: string) => Promise<Response> | Response;
export function withRequestId(handler: RequestHandler): (req: Request) => Promise<Response>;
```
`withRequestId` injects the request id, sets `x-request-id` on the response, logs `{ level, request_id, msg, ... }` (method/url/status/duration_ms), and converts thrown errors via `errorResponse`. Unknown errors → 500 `internal_error`, internals never leaked.

## 8. `src/lib/api/crypto.ts`

```ts
export async function hashSecret(secret: string): Promise<string>;                 // SHA-256 hex
export function timingSafeEqualHex(a: string, b: string): boolean;
export async function verifySecret(secret: string, hash: string): Promise<boolean>;
export function generateToken(bytes = 32): string;                                 // hex, 256-bit default
export function signWebhook(secret: string, t: number, rawBody: string): Promise<string>; // HMAC-SHA256(secret, `${t}.${rawBody}`) hex
export async function buildSignatureHeader(secret: string, rawBody: string): Promise<string>; // `t=<unix>,v1=<hex>`
export async function verifySignatureHeader(secret: string, header: string, rawBody: string, toleranceSec = 300): Promise<boolean>;
```
Web Crypto only (`globalThis.crypto`) — no Node `crypto` import, so it runs in Route Handlers/Edge/browser. `verifySignatureHeader` rejects missing/malformed headers and timestamps `|now-t| > 300`s (stale **and** future beyond tolerance).

### Security choice (documented)
`hashSecret` is **unsalted SHA-256 hex**. Acceptable here because every hashed secret is a 256-bit random value minted by `generateToken` (device tokens, API keys, webhook secrets) — brute-force is infeasible and the digest is needed for deterministic lookups. This helper is not for low-entropy material; Supabase Auth owns user credentials. `generateToken` returns **hex** (brief allowed hex/base64url).

## 9. Tests — `src/lib/__tests__/`

| File | Tests | Coverage |
|---|---|---|
| `reference.test.ts` | 14 | charset/look-alikes; 1000 refs valid+uppercase; single-char substitution rejected over 1000 refs; adjacent transposition rejected over 1000 refs; normalise (`REF934P923`→`934P923`, case, punctuation, round-trip); validity; `suggestNearMatch` incl. ambiguity→null |
| `money.test.ts` | 8 | paisa↔BDT, formatting (`Tk 1,200.00`, compact), 5% fee = 6000 paisa / net 114000 for Tk 1200, nearest-paisa rounding, fee+net invariant |
| `crypto.test.ts` | 10 | SHA-256 hash determinism + verify; constant-time compare; token length/randomness; webhook sign→verify round-trip; tamper (body/header/secret) fails; malformed header fails; stale & future timestamps fail, tolerance honoured |
| `errors.test.ts` | 14 | status/code mapping for all 9 factories incl. `no_wallet_available`=503; custom message/details; `errorResponse` envelope incl. details and 500 non-leak |

### Verification output
```
npx vitest run
 Test Files  4 passed (4)
      Tests  46 passed (46)
```
```
npx tsc --noEmit
EXIT: 0   (0 errors)
```
(`next build` intentionally not run.)

## 10. Deviations / assumptions to confirm

1. **Module path (SPEC vs brief).** SPEC §2 names `src/lib/reference.ts`; the brief (and file ownership) mandate `src/lib/domain/reference.ts`. I followed the brief. **Downstream must import `@/lib/domain/reference`.** If a shim at `src/lib/reference.ts` is wanted, that path is outside my ownership — needs a controller call.
2. **`normalizeReference` REF-strip guard.** The literal rule "drop a leading REF token" would corrupt genuine references that begin with R-E-F (charset includes R/E/F). I strip `REF` **only when it leaves more than a full-length token** (`out.length > 8`), so `REF934P923`→`934P923` still works while an 8-char `REF…` reference survives. Covered by a test.
3. **`providers.ts` metadata not specified in brief:** `referenceMode` set to `"echo"` for all three providers (SPEC is reference-first with TrxID fallback for every provider) and `refFieldMaxLen` = 20 (matches the parser's 6..20 token window). `"trxid_only"` remains in the type for providers whose SMS omits the customer reference. Confirm these values with the controller/Architect before downstream relies on them.
4. **`newId` slice length = 24 hex chars** (unspecified).
5. **`errorResponse` adds a nested `details` key when an `ApiError` carries details** (base envelope is exactly `{ code, message, request_id }`).
6. **`hashSecret` unsalted** and **`generateToken` hex** — both documented in §8; brief permitted these choices.

## 11. For Sentinel / Probe

- **Sentinel:** confirm the unsalted-SHA-256 rationale for high-entropy secrets (§8); confirm `suggestNearMatch` is only ever surfaced to operators (it is never auto-applied); confirm `verifySignatureHeader` future-timestamp rejection beyond tolerance is desired.
- **Probe:** adversarial cases — reference normalisation of look-alike inputs (`O0I1L`), `suggestNearMatch` ambiguity, `errorResponse` for non-`Error` throwables (strings/objects), webhook header parsing with reordered/extra fields, and confirmation that `no_wallet_available` surfaces as HTTP 503.
