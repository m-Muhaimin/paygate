# PayGate — Merchant API: plans, payments, pay page, onboarding — report

**Task:** build the merchant-facing HTTP surface for pricing plans, payments, the
public hosted pay page, and merchant onboarding, on top of the shared plumbing and
core libs.
**Repo:** `W:\pay_gate\paygate-saas` (win32, bash, non-interactive — `next build` not run).
**Normative sources read:** `SPEC_v3.md` (§1 money, §3 payment states, §4 matching,
§5 wallets, §6 schema, §7 API surface, §8 webhooks), `.reports/db.md`,
`.reports/core-lib.md`, `.reports/plumbing.md`, `supabase/migrations/20261013000001_init.sql`.
**Framework:** Next.js 16 App Router Route Handlers (`src/app/api/**/route.ts`).
**Status:** complete (one known cross-agent gap — §5.5).
**Commits:** none — the repo still has **no commits at all** (untracked tree); committing was not requested.
**Verify:** `npx vitest run` → **83/83 pass** (23 new). Type-check of the new surface is
clean except the one expected cross-agent `TS2307` (§5.5); the repo-wide
`npx tsc --noEmit` is currently blocked by a pre-existing error in another agent's
file (§5.6).

---

## 1. Files created / changed (all within owned paths)

| Path | Purpose |
|---|---|
| `src/lib/services/serializers.ts` | `serializePayment` / `serializePlan` / `toWalletView` + view types (paisa **and** `*_bdt` strings) |
| `src/lib/services/validation.ts` | `readJsonBody(req)`, `parseOrThrow(schema, data, message)` → canonical `400` |
| `src/lib/services/plans.ts` | `createPlanSchema`, `updatePlanSchema`, `listPlans`, `getPlan`, `createPlan`, `updatePlan` (versioning) |
| `src/lib/services/payments.ts` | `createPaymentSchema`, `submitTrxSchema`, `createPayment`, `listPayments`, `getPayment`, `cancelPayment`, `getPayPage`, `submitPaymentTrx` |
| `src/lib/services/onboarding.ts` | `onboardingSchema`, `applyForMerchant` |
| `src/lib/services/webhooks.ts` | `dispatchPaymentEvent(merchantId, type, payment)` — lazy seam over `@/lib/webhooks/dispatch` |
| `src/app/api/v1/plans/route.ts` | `POST` (201), `GET` (200) |
| `src/app/api/v1/plans/[id]/route.ts` | `GET` (200), `PATCH` (200) |
| `src/app/api/v1/payments/route.ts` | `POST` (201, idempotent), `GET` (200, paginated) |
| `src/app/api/v1/payments/[id]/route.ts` | `GET` (200) |
| `src/app/api/v1/payments/[id]/cancel/route.ts` | `POST` (200) |
| `src/app/api/v1/pay/[id]/route.ts` | `GET` (200, public, 10/min/IP) |
| `src/app/api/v1/pay/[id]/submit-trx/route.ts` | `POST` (200, public, 10/min/IP) |
| `src/app/api/v1/onboarding/apply/route.ts` | `POST` (201, public, 5/min/IP) |
| `src/lib/__tests__/services.test.ts` | Endpoint + service tests (mocked `db()` / `assignWallet()`) |

Untouched, as required: `src/app/api/v1/{sms,devices,balance,settlements,payouts,admin}/**`,
`src/components/**`, `src/lib/{db,api,domain}/**`, `supabase/**`, `package.json`.

**Legacy routes NOT deleted** — see §5.4.

---

## 2. Contract implemented (matches SPEC §7 exactly)

All merchant routes authenticate with `Authorization: Bearer sk_live_…/sk_test_…`
via `authenticateMerchant` and use the shared envelope
`{ error: { code, message, request_id, details? } }`. Money is **integer paisa** on
the wire; serializers additionally emit a display string (`amount_bdt`, etc.).

| Method + path | Auth | Success | Notes |
|---|---|---|---|
| `POST /v1/plans` | merchant | `201` `SerializedPlan` | fixed **or** open-amount plan, `version: 1`, `active` |
| `GET /v1/plans?status=` | merchant | `200 { data: [...] }` | newest first |
| `GET /v1/plans/:id` | merchant | `200 SerializedPlan` | scoped to merchant → else `404` |
| `PATCH /v1/plans/:id` | merchant | `200 SerializedPlan` | **field edit = new version row** (`version+1`, active; old archived). `{status:"archived"}` archives in place |
| `POST /v1/payments` | merchant + **`Idempotency-Key`** | `201 SerializedPayment` | see order-of-ops below |
| `GET /v1/payments?status&provider&limit&cursor` | merchant | `200 { data, next_cursor }` | keyset pagination, `limit ≤ 100` |
| `GET /v1/payments/:id` | merchant | `200 SerializedPayment` | |
| `POST /v1/payments/:id/cancel` | merchant | `200 SerializedPayment` | non-terminal only; emits `payment.cancelled` (best-effort) |
| `GET /v1/pay/:id` | **public** (10/min/IP) | `200 PayPageView` | customer-safe fields only |
| `POST /v1/pay/:id/submit-trx` | **public** (10/min/IP) | `200 { ok, status }` | persists `submitted_trx_id` |
| `POST /v1/onboarding/apply` | **public** (5/min/IP) | `201 { merchant_id, status }` | creates `pending` merchant |

**`POST /v1/payments` order of operations** (SPEC §7): authenticate → **idempotency
lookup** → load plan → `assign_wallet` → allocate reference → snapshot plan →
`awaiting_payment` with `expires_at = now + PAYMENT_TTL_MIN` (default 30). A replay
returns the original payment **without** re-assigning a wallet. `pay_url =
new URL('/pay/'+id, req.url)`.

**Status codes per endpoint** (`tests` exercise each):

| Endpoint | Codes |
|---|---|
| `POST /v1/plans` | 201, 400 (missing/contradictory amount), 401 |
| `POST /v1/payments` | 201, 400 (no `Idempotency-Key`, bad provider, bad body), 401, **404** (plan), **422** (open-amount plan), **503** (`no_wallet_available`) |
| `POST /v1/payments/:id/cancel` | 200, 401, 404, **409** (terminal) |
| `GET /v1/pay/:id` | 200, 404, 429 |
| `POST /v1/pay/:id/submit-trx` | 200, 400, 404, 409, 429 |
| `POST /v1/onboarding/apply` | 201, 400, 429 |

---

## 3. Test results

`src/lib/__tests__/services.test.ts` — 23 tests. `db()` and `assignWallet()` are mocked
at the boundary; the **real** route handlers and services run, so auth, validation,
status codes and the exact rows written are all asserted together.

- **plans:** version-1 create; fixed-without-amount and `min>max` → 400; edit inserts
  **version 2** and archives version 1 (`inserted`/`updated` payloads asserted).
- **payments create:** happy path → 201 with `fee_amount=5000` /
  `net_amount=95000` off `amount=100000` @ 500 bps; row written with
  `offered_wallet_ids=[wal]`, single-use reference (`/^[2-9A-HJKMNP-Z]{8}$/`), TTL
  ~30 min; **idempotent replay** returns the original and never calls `assignWallet`;
  400 (missing `Idempotency-Key`, unknown provider); **401 with no DB call**; **503**
  when `assignWallet → null`; **422** open-amount plan; **404** unknown plan.
- **payments list:** `next_cursor` present when a further page exists.
- **reads/cancel:** `GET /v1/payments/:id`; cancel transitions `awaiting_payment →
  cancelled`; **409** on a `paid` payment with no write; the cancel **route** returns
  200 even when the webhook dispatcher is unavailable (graceful degradation).
- **pay page:** customer-only fields (asserts **no** `fee_amount`/`net_amount`/
  `metadata`/`callback_url` leak); `trxid_required` derived from
  `PROVIDERS[provider].referenceMode`; 404 unknown; `submit-trx` persists the TrxID
  while open and **409**s once terminal.
- **onboarding:** `pending` merchant created with `kyb_status = under_review` and the
  applicant recorded in `audit_log` (`onboarding.applied`); route 201 + 400 malformed.

```
$ npx vitest run src/lib/__tests__/services.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)

$ npx vitest run
 Test Files  6 passed (6)
      Tests  83 passed (83)          # 23 new + 60 existing
```

Type-check of the new surface (temp project limited to `src/lib/services/**` +
`src/app/api/v1/**`, excluding the pre-existing broken file in §5.6):

```
$ npx tsc -p <temp tsconfig>
src/lib/services/webhooks.ts(24,42): error TS2307: Cannot find module '@/lib/webhooks/dispatch'
```

That single error is the **expected cross-agent gap** (§5.5); everything else in the
new surface type-checks cleanly under `strict`.

---

## 4. Environment variables

| Var | Required | Notes |
|---|---|---|
| `PAYMENT_TTL_MIN` | optional | Payment lifetime in minutes; default **30**. Already in `.env.example` (not mine to edit). |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | see `.reports/plumbing.md` §4 | All DB access goes through `db()` (needs the service-role key for the RPC + RLS-less tables). |

---

## 5. Concerns / deviations (for the controller)

1. **`kyb_status` has no `submitted` value.** SPEC §6 / migration 0001 define
   `kyb_status` as `pending | under_review | approved | rejected` — there is no
   `submitted`. A just-submitted application is therefore recorded as
   **`under_review`** (constant `KYB_ON_SUBMIT` in `src/lib/services/onboarding.ts`),
   the closest existing state. Merchant `status` stays `pending`. If the enum should
   gain `submitted`, it is a one-line change here plus a migration.
2. **`merchants` has no contact columns.** There is no `email`/`phone`/`business_type`
   on `merchants` (SPEC §6). To avoid dropping the applicant's data, the full
   onboarding payload is written to the append-only, RLS-locked `audit_log`
   (`action: "onboarding.applied"`, `after` = `{name,email,phone,business_type,
   payout_account}`) **best-effort** — an audit failure is warn-logged and does not
   fail the application. I did **not** alter the schema (SPEC §6 is normative).
   **Controller decision wanted:** if KYB needs these queryable, add the columns (or a
   `merchant_applications` table) and I will read/write them directly.
3. **Open-amount plans cannot create a payment.** `POST /v1/payments` body carries no
   `amount` (SPEC §7), so a plan with `open_amount = true` has nothing to charge; the
   endpoint returns **`422 unprocessable`** rather than inventing a field. **Spec gap —
   please confirm** the intended flow (e.g. an optional `amount` on the payment body,
   validated against `min_amount`/`max_amount`).
4. **Legacy routes left in place (not deleted).** The brief permits deleting
   `src/app/api/payments/route.ts`, `src/app/api/contact/route.ts`, and
   `src/app/api/auth/registration/route.ts`. I did **not**, because three live pages
   still `fetch` them and they are outside my ownership:
   `src/app/checkout/page.tsx` → `/api/payments`,
   `src/app/page.tsx` → `/api/contact`,
   `src/app/registration/page.tsx` → `/api/auth/registration`.
   They don't path-conflict with the new `/v1/*` surface, so deleting them now would
   break those flows with no replacement (the v1 onboarding endpoint is a merchant
   application, not dashboard registration). **Please coordinate with the frontend
   owner** — once those pages are repointed, deleting the three legacy handlers is safe.
5. **Expected `TS2307` — `@/lib/webhooks/dispatch` does not exist yet.** The webhook
   dispatcher is a parallel agent's deliverable. `src/lib/services/webhooks.ts` does a
   **lazy** `await import("@/lib/webhooks/dispatch")` and calls
   `dispatchEvent(merchantId, type, payment)`; cancellation calls it inside a
   `try/catch` that only warn-logs, so a missing/broken dispatcher can never fail a
   state change. When that module lands, the single `TS2307` disappears with **no
   change here**. This is why the repo-wide `tsc` will show one error in this file
   until then.
6. **Repo-wide `tsc` is currently blocked by another agent's file.**
   `src/lib/client/query.ts` line 818 contains JSX (`<QueryClientProvider …>`) in a
   **`.ts`** file → `TS1005/TS1161/TS1128` and `tsc` stops before semantic checking.
   The file should be `query.tsx`. This is outside my ownership; flagged so the final
   type-check is not misread as a problem in this surface.
7. **`Retry-After` header on `429`** (inherited from `.reports/plumbing.md` §5.3): my
   public routes throw `tooManyRequests()` via `enforceRateLimit`, and the canonical
   `errorResponse` does not lift `details.retry_after` into a header. If SPEC §7's
   `Retry-After` is required on the pay endpoints, core-lib `errorResponse` should map
   it (one place) or the routes should set it — flagging rather than touching
   another agent's file.

## 6. For Sentinel / Probe

- **Sentinel:** confirm the pay page never exposes `fee_amount`/`net_amount`/
  `metadata`/`callback_url` (asserted in tests); confirm `POST /v1/payments` allocates
  the reference **inside** the idempotency block and retries only on a `reference`
  unique-violation (not on an `idempotency_key` collision, which is re-thrown for
  `withIdempotency` to resolve); confirm the public routes are the only unauthenticated
  ones; confirm `PAYMENT_TTL_MIN` is bounded (non-positive → default 30).
- **Probe:** adversarial cases — replayed `Idempotency-Key` concurrent race
  (`23505` → returns winner), a payment whose plan was archived between load and insert,
  cancel racing a match (`update … where status in (created, awaiting_payment)` returns
  no row → `409`), `submit-trx` on a payment that just expired, a `limit`/`cursor`
  combination that yields an empty page, and an onboarding payload whose `payout_account`
  carries extra keys (`passthrough` retains them in the audit `after`).
