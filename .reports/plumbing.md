# PayGate — Shared backend plumbing — report

**Task:** build the shared backend plumbing every downstream API route imports.
**Repo:** `W:\pay_gate\paygate-saas` (win32, bash, non-interactive).
**Normative sources read:** `SPEC_v3.md` (§1 money/time, §3/§4 states/matching, §5 wallets, §6 schema, §7 API surface, §8 webhooks, §9 security), `.reports/db.md`, `.reports/core-lib.md`, `docs/db-schema.md`, `supabase/migrations/*`.
**Status:** complete.
**Commits:** none — the repo still has **no commits at all** (untracked working tree) and committing was not requested.
**Verify:** `npx vitest run` → **60/60 pass**; `npx tsc --noEmit` → **0 errors**; `npx eslint` on the new files → **0 errors**. (`next build` intentionally not run.)

---

## 1. Files created (all within owned paths)

| Path | Purpose |
|---|---|
| `src/lib/db/client.ts` | Lazy Supabase clients: `db()`, `dbAsUser()`, `isPrivileged()` |
| `src/lib/db/types.ts` | Canonical hand-written row types + enum unions |
| `src/lib/db/rpc.ts` | Typed wrappers for the DB helper functions |
| `src/lib/api/keys.ts` | API key mint/hash/mask + bearer parsing |
| `src/lib/api/tenant.ts` | Merchant (API-key) auth + role authorization |
| `src/lib/api/device-auth.ts` | Device token auth |
| `src/lib/api/ratelimit.ts` | In-memory sliding-window limiter |
| `src/lib/api/audit.ts` | Audit-log writer + actor extraction |
| `src/lib/api/idempotency.ts` | Idempotency-key lookup + `withIdempotency` |
| `src/lib/__tests__/plumbing.test.ts` | Unit tests (mocked `db()`) |

Untouched, as required: `src/components/**`, `src/app/**`, `supabase/**`, and all core-lib files (`domain/*`, `api/crypto.ts`, `api/errors.ts`, `api/http.ts`, `supabase.ts`). Only new files were added to `src/lib/db/**` and `src/lib/api/**` + the one test file.

---

## 2. Exact exported signatures (downstream imports these blind)

### `@/lib/db/client`

```ts
function isPrivileged(): boolean;
function db(): SupabaseClient;                    // @supabase/supabase-js SupabaseClient
function dbAsUser(accessToken: string): SupabaseClient;
```
- `db()` reads env **lazily** and caches by `(url, key)`; prefers `SUPABASE_SERVICE_ROLE_KEY`, falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`; throws `internal()` (500) when `NEXT_PUBLIC_SUPABASE_URL` + a key are absent — never at import time, so builds need no secrets.
- `dbAsUser(token)`: always built with the anon key + `Authorization: Bearer <token>` so Postgres RLS runs as that user.
- Both server clients set `auth.persistSession=false`, `autoRefreshToken=false`.

### `@/lib/db/types` (row types — `string` = ISO timestamptz, `number` = integer paisa)

```ts
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Provider = "bkash" | "nagad" | "rocket";            // re-export of @/lib/domain/providers

type MerchantStatus = "pending"|"active"|"suspended";
type KybStatus      = "pending"|"under_review"|"approved"|"rejected";
type RiskTier       = "low"|"medium"|"high";
type PlanStatus     = "active"|"archived";
type WalletStatus   = "active"|"draining"|"disabled";
type DeviceStatus   = "active"|"revoked";
type PaymentStatus  = "created"|"awaiting_payment"|"paid"|"expired"|"cancelled"|"needs_review";
type ReviewReason   = "underpaid"|"overpaid"|"wrong_wallet"|"late_payment"|"duplicate_ref"|"conflict"|"unmatched";
type MatchedBy      = "reference"|"trxid";
type LedgerAccount  = "payin"|"fee"|"merchant_payable"|"payout"|"refund";
type LedgerDirection= "debit"|"credit";
type SettlementStatus = "pending"|"processing"|"paid";
type PayoutRail     = "bank"|"mfs";
type PayoutStatus   = "requested"|"approved"|"rejected"|"paid";
type WebhookStatus  = "pending"|"success"|"failed";
type Role           = "owner"|"staff"|"developer"|"viewer";
type ApiKeyPrefix   = "sk_live_"|"sk_test_";

interface PayoutAccount      { type?: "bank"|"mfs"; provider?: Provider; account_no?: string; holder?: string; bank_name?: string; [k: string]: Json|undefined }
interface PayoutDestination  { account_no?: string; holder?: string; bank_name?: string; provider?: Provider; [k: string]: Json|undefined }
interface PlanSnapshot       { id?: string; name?: string; amount?: number|null; currency?: string; version?: number; [k: string]: Json|undefined }

interface Merchant        { id; name; status: MerchantStatus; kyb_status: KybStatus; payout_account: PayoutAccount|null; fee_rate_bps: number; risk_tier: RiskTier; webhook_secret_hash: string|null; created_at }
interface PricingPlan     { id; merchant_id; name; amount: number|null; currency; external_sku: string|null; version: number; status: PlanStatus; open_amount: boolean; min_amount: number|null; max_amount: number|null; created_at }
interface Wallet          { id; provider: Provider; msisdn; holder_name: string|null; device_id: string|null; sim_slot: number|null; status: WalletStatus; daily_limit: number; monthly_limit: number|null; today_total: number; concurrency_cap: number; last_assigned_at: string|null; created_at }
interface Device          { id; name: string|null; model: string|null; app_version: string|null; token_hash: string|null; status: DeviceStatus; last_heartbeat_at: string|null; battery: number|null; queue_depth: number; permissions: Json; created_at }
interface Payment         { id; merchant_id; plan_id: string|null; plan_snapshot: PlanSnapshot|null; order_id: string|null; provider: Provider; wallet_id: string|null; offered_wallet_ids: string[]|null; amount: number; fee_amount: number; net_amount: number; reference; status: PaymentStatus; review_reason: ReviewReason|null; matched_by: MatchedBy|null; submitted_trx_id: string|null; idempotency_key: string|null; callback_url: string|null; metadata: Json|null; expires_at: string|null; paid_at: string|null; created_at }
interface IncomingTxn     { provider: Provider; trx_id; wallet_id; amount: number; balance_after: number|null; ref_raw: string|null; ref_normalized: string|null; raw: string|null; client_msg_id: string|null; sim_slot: number|null; claimed_payment_id: string|null; flags: string[]|null; received_at; created_at }   // no id
interface LedgerEntry     { id; merchant_id; payment_id: string|null; account: LedgerAccount; direction: LedgerDirection; amount: number; entry_group; created_at }
interface Settlement      { id; merchant_id; period_start; period_end; gross_amount: number; fee_amount: number; net_amount: number; status: SettlementStatus; created_at }
interface Payout          { id; merchant_id; amount: number; rail: PayoutRail; destination: PayoutDestination|null; status: PayoutStatus; requested_by: string|null; approved_by: string|null; approved_at: string|null; created_at }
interface WebhookDelivery { id; merchant_id; payment_id: string|null; event_type; event_id; url; payload: Json|null; status: WebhookStatus; attempts: number; next_attempt_at: string|null; last_status_code: number|null; created_at }
interface AuditLog        { id; actor: string|null; action; entity_type: string|null; entity_id: string|null; before: Json|null; after: Json|null; ip: string|null; created_at }
interface MerchantUser    { id; merchant_id; auth_user_id: string; role: Role; email: string|null; created_at }
interface ApiKey          { id; merchant_id; key_hash; prefix: ApiKeyPrefix; label: string|null; created_at; revoked_at: string|null; last_used_at: string|null }
interface DevicePairingCode { code; merchant_id; expires_at; used_at: string|null; created_at }
```
(Timestamps above are `string`; `id`/`name`/etc. are `string`. Every column in `docs/db-schema.md` is present.)

### `@/lib/db/rpc`

```ts
function assignWallet(provider: Provider, merchantId: string): Promise<Wallet | null>;
interface ClaimIncomingTxnArgs { provider: Provider; trxId: string; walletId: string; paymentId: string }
function claimIncomingTxn(args: ClaimIncomingTxnArgs): Promise<boolean>;
function merchantBalance(merchantId: string): Promise<number>;   // integer paisa, 0 when none
```
- `assignWallet` → `db().rpc("assign_wallet", { p_provider, p_merchant_id })`; returns `null` on no-rows (caller maps to `503 no_wallet_available`), throws `internal()` on a real RPC error.
- `claimIncomingTxn` → `true` only for the winning call (`data === true`); `internal()` on RPC error.
- `merchantBalance` → `Number(data ?? 0)`; `internal()` on RPC error. RPC errors never leak the raw PostgREST message (details carry `{ rpc, code }` only).

### `@/lib/api/keys`

```ts
type ApiKeyMode = "live" | "test";
type ApiKeyPrefix = "sk_live_" | "sk_test_";
interface GeneratedApiKey { plaintext: string; hash: string; prefix: ApiKeyPrefix }
function generateApiKey(mode: ApiKeyMode): Promise<GeneratedApiKey>;   // plaintext = `${prefix}${generateToken(32)}`
function hashApiKey(plaintext: string): Promise<string>;               // SHA-256 hex (crypto.hashSecret)
function maskApiKey(plaintext: string): string;                        // "sk_live_…abcd" (scheme + last 4)
function getBearerToken(req: Request): string | null;                  // zod-parsed `Authorization: Bearer <token>`
```

### `@/lib/api/tenant`

```ts
function authenticateMerchant(req: Request): Promise<{ merchant: Merchant }>;
function requireRole(merchantUserId: string, roles: Role[]): Promise<MerchantUser>;
```
- `authenticateMerchant`: `Authorization: Bearer sk_live_…/sk_test_…` → hash → `api_keys.key_hash` where `revoked_at IS NULL`, then load the merchant and require `status === "active"`, then stamp `last_used_at` (best-effort). Throws `unauthorized()` (401) for missing/malformed/non-`sk_` token, unknown/revoked key, or inactive merchant; `internal()` on DB error.
- `requireRole`: loads `merchant_users` by **`merchant_users.id`** and throws `forbidden()` (403) if unknown or the role is not in `roles`.

### `@/lib/api/device-auth`

```ts
function authenticateDevice(req: Request): Promise<{ device: Device }>;
function requireDeviceMerchant(req: Request): Promise<{ device: Device }>;
```
- `authenticateDevice`: bearer device token → SHA-256 hash lookup on `devices.token_hash` → `unauthorized()` (401) if missing/unknown/`token_hash IS NULL`; rejects `status === "revoked"` with 401; confirms with constant-time `verifySecret(token, token_hash)`.
- `requireDeviceMerchant`: see the flagged concern in §5 (platform-scoped fleet has no device→merchant column).

### `@/lib/api/ratelimit`

```ts
interface RateLimitResult { ok: boolean; remaining: number; retryAfter: number }
function rateLimit(key: string, limit: number, windowSec: number, now?: number): RateLimitResult;  // now = test clock
function clientIp(req: Request): string;                                                          // x-forwarded-for (1st) → x-real-ip → "unknown"
function enforceRateLimit(req: Request, bucket: string, limit: number, windowSec: number): void;  // throws tooManyRequests() (429)
```
- Sliding window over module-scope state; blocked calls carry `details = { bucket, limit, window_sec, retry_after }` (seconds), `retryAfter >= 1`.
- Comment documents the **per-instance Vercel caveat** and the upgrade path (Upstash `@upstash/ratelimit` or a Postgres counter + `pg_cron`). Memory is bounded by a stale-bucket sweep above 10k keys.
- `enforceRateLimit` throws the canonical `ApiError`; see the `Retry-After` header caveat in §5.

### `@/lib/api/audit`

```ts
interface AuditInput { actor: string; action: string; entityType: string; entityId: string; before?: Json|null; after?: Json|null; ip?: string|null }
function recordAudit(input: AuditInput): Promise<AuditLog>;      // insert → select → single; internal() on error
function actorFromRequest(req: Request): string;                 // x-actor → user:<jwt sub> → api_key:<scheme> → device → ip:<clientIp>
```

### `@/lib/api/idempotency`

```ts
function findByIdempotencyKey(merchantId: string, key: string): Promise<Payment | null>;
function withIdempotency(merchantId: string, key: string | null | undefined, fn: () => Promise<Payment>): Promise<Payment>;
```
- Lookup by `(merchant_id, idempotency_key)`; if present, return it without running `fn`. On a race, the DB partial unique index raises `23505`, which is caught, the key re-read, and the winner's row returned.

---

## 3. Test results

`src/lib/__tests__/plumbing.test.ts` — 14 tests, all with `db()` mocked via `vi.mock("@/lib/db/client")`:

- **keys**: mint→hash→`verifySecret` round-trip, 64-hex hash, mask format `sk_live_…abcd`, `sk_test_` variant, bearer parse + malformed-header rejection.
- **ratelimit**: deterministic allow (remaining 1→0) → block with `retryAfter === 58` → allowed again after the window slides; `enforceRateLimit` throws `ApiError` 429 with `details.retry_after >= 1`; `clientIp` first-hop extraction.
- **idempotency**: replayed key returns existing without calling `fn`; **second call with the same key returns the first result and runs `fn` once**; no key → `fn` always runs; `findByIdempotencyKey` row/null.
- **authenticateMerchant**: missing bearer → 401 (no DB call); non-`sk_` token → 401 (no DB call); unknown key → 401; valid key + non-active merchant → 401; valid key + active merchant → returns merchant and makes 3 DB calls (lookup key, load merchant, stamp `last_used_at`).

```
$ npx vitest run
 Test Files  5 passed (5)
      Tests  60 passed (60)          # 14 new + 46 existing core-lib
```

```
$ npx tsc --noEmit
EXIT=0   (0 errors)
$ npx eslint src/lib/db src/lib/api/{tenant,device-auth,ratelimit,audit,keys,idempotency}.ts src/lib/__tests__/plumbing.test.ts
EXIT=0
```

---

## 4. Environment variables required

| Var | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes (runtime) | Supabase project URL. Read lazily. |
| `SUPABASE_SERVICE_ROLE_KEY` | strongly recommended | **Server-only**, never `NEXT_PUBLIC_`, never committed. Privileged `db()` path (`BYPASSRLS`) — required for the RPC helpers (`assign_wallet`, `claim_incoming_txn`, `merchant_balance`, all `service_role`-only) and for writes to RLS-no-policy tables (`audit_log`, `wallets`, `devices`, `incoming_txns`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes (fallback) | Browser-safe. Used when the service key is absent and by `dbAsUser()`. |

`.env.local` is gitignored (`/.env*`). `.env.example` already lists `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and commented `SUPABASE_SERVICE_ROLE_KEY` (owned by another agent; not modified).

---

## 5. Concerns / deviations (for the controller, Sentinel, Probe)

1. **Table names are unprefixed.** The PayGate migrations (`supabase/migrations/*`) and `docs/db-schema.md` use the plain names (`merchants`, `api_keys`, …), and PayGate has its own `supabase/config.toml` (`project_id = "paygate"`). I matched that. The muhai-shared Supabase project convention (`<PREFIX>_<table>` via `~/.supabase/projects.json`) does **not** list a PayGate prefix, so it is not applied. If PayGate is ever moved onto the shared project, either the schema needs prefixing or the client needs a prefix adapter — flagging because it affects every query.
2. **`requireDeviceMerchant` has no data to work with.** `devices` has no `merchant_id` (`db.md` §6.2: platform-scoped fleet) and there is no device→merchant table. I implemented it as an authenticated-device guard returning `{ device }`, documented in-file. **Needs a controller decision**: if a device→merchant binding is required, add `devices.merchant_id` (or a `device_pairings` table) and I will enforce it here.
3. **`Retry-After` header on 429.** `enforceRateLimit` throws `tooManyRequests()` carrying `details.retry_after` (seconds) per the brief, but the canonical envelope serializer `errorResponse` in **core-lib `@/lib/api/http.ts` (not in my ownership)** does not copy `details.retry_after` into a response header. SPEC §7 says `429` with `Retry-After`. To fully comply, either core-lib `errorResponse` should map `details.retry_after` → `Retry-After`, or the public routes should set the header from the thrown error. Flagged rather than touching another agent's file.
4. **`requireRole` matches `merchant_users.id`.** The arg name `merchantUserId` is ambiguous vs `auth_user_id`; I matched the table's primary key (`mru_…`). If the intended lookup is the Supabase Auth user (`auth_user_id`, i.e. JWT `sub`), it is a one-line change — please confirm.
5. **`db()` throws `internal()` (ApiError) on missing env**, not a bare `Error`. This keeps error semantics uniform (`errorResponse` → 500 `internal_error`), but it does mean a misconfigured deployment surfaces as a generic 500 rather than a startup failure.
6. **`getBearerToken` is a small extra export** in `keys.ts` (zod-parsed `Authorization` header), shared by `tenant.ts`, `device-auth.ts`, and `audit.ts` to avoid duplicating header parsing. No other signature deviates from the brief.

## 6. For Sentinel / Probe

- **Sentinel:** confirm the privileged-only path for the three `db().rpc` helpers and that `dbAsUser` always uses the anon key (RLS as the user); confirm `internal()` error details never include raw PostgREST messages (`{ rpc, code }` only); confirm `api_keys.last_used_at` stamping failures are warn-logged, not fatal.
- **Probe:** adversarial cases — `withIdempotency` under a simulated `23505` race (returns winner), `authenticateMerchant` with a revoked key / inactive merchant, `authenticateDevice` with a revoked device and a `token_hash IS NULL` row, `enforceRateLimit` window-slide and multi-IP isolation, `actorFromRequest` with a JWT-shaped token vs an `sk_` token, and `maskApiKey` on a malformed/short string.
