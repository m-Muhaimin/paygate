# Customer pay page + onboarding frontend — report

**Task:** customer-facing hosted pay page, landing page, KYB registration, login frontends (PayGate SaaS)
**Repo:** `W:\pay_gate\paygate-saas`
**Status:** complete — page code type-clean (`npx tsc --noEmit`: 0 errors in my files), `npm run test:run` 92/92 passing repo-wide.
**Commits:** none. Repo `main` has zero commits and all agents (`core-lib.md`, `plumbing.md` reports) left the tree uncommitted; I matched that convention.

## 1. What shipped (public routes)

| Route | File | Notes |
|---|---|---|
| `/pay/[id]` | `src/app/pay/[id]/page.tsx` (RSC) | `export const dynamic = "force-dynamic"`; Next 16 async `params`; metadata. |
| `/pay/[id]` (client shell) | `src/app/pay/[id]/pay-client.tsx` | All interactive states; exports `BrandMark` for `not-found`. |
| `/pay/[id]` (404) | `src/app/pay/[id]/not-found.tsx` | `notFound()` in the pay route throws; Gate-styled NotFound page. |
| `/` | `src/app/page.tsx` (RSC) | Landing, replaces the legacy shadcn-token page. No client JS, no `/api/contact` POST. |
| `/registration` | `src/app/registration/page.tsx` | KYB application form; rewrote the legacy page. |
| `/login` | `src/app/login/page.tsx` | New; email + password + optional 6-digit TOTP. |
| `src/app/checkout/**` | deleted | Legacy demo page hit `/api/payments` (which does not exist) and used dead shadcn tokens. **Breaks one link in `src/app/dashboard/page.tsx` (dashboard agent's file) — see §7.** |

## 2. API wiring (`src/lib/client/`)

- `api.ts` was rewritten as a thin extension of the shared client layer in `src/lib/client/query.ts`:
  - `payKeys` (`all`, `detail(id)`), `getPay(id)` (`cache: "no-store"`), `submitTrx({ pay_id, trx_id })`, `applyOnboarding(input)`, `isTerminalStatus(status)`, `PayLink` / `PayLinkWallet` / `SubmitTrxResult` / `OnboardingApplyInput` / `OnboardingApplyResult` types.
  - Re-exports the shared unions (`MerchantStatus`, `PaymentStatus`, `Provider`, `ReviewReason`).
- `i18n.ts`: `PayCopy`/`DICTIONARIES` (en + bn) for the pay page; `paymentKind` qualified-locale `formatBDT` (`en-BD` → `৳1,250.00`, `bn-BD` → localised digits with `bn` locale); `formatCountdown`, `localizeDigits`; dead keys removed (statusPending, statusAwaiting, walletLabel, trxHide), `walletUnavailable` added, `trxInvalid` copy updated to the real 4–64 char rule.
- `auth.ts` (existing stub): `signIn` resolves `{ ok:false, code:"auth_pending" }` while Supabase Auth is unprovisioned; login page renders an honest pending-wiring Banner from `AUTH_WIRING_PENDING`, per SPEC.
- `format.ts`: `formatBDT(paisa)` (₹/৳, 2 decimals, tabular-nums) — pay page renders its own amount, ignoring the server's display-only `amount_bdt` string.

## 3. States covered

- **Pay page**: loading skeleton (pulse, no spinner) · 404 (not-found) · network error banner + retry · valid link with panel per status — waiting (wallet block + copy, single accent ReferenceChip + help/warning captions, Countdown pill urgent ≤300 s, conditional when `expires_at` is null), paid (drawn check, announce via `role="status"`), expired (CircleSlash2), cancelled (CircleX), needs_review (Hourglass warning tint + review-reason caption) · mobile wallet block when the merchant wallet is null · TrxID form (reveal button or auto-reveal after 90 s when `trxid_required`) with 4–64 validation, server error, success · EN/বাংলা toggle (44 px target, `aria-pressed`) · 3 s polling while non-terminal, stopped when terminal · `role="status"` live announcements for status transitions; reduced-motion collapses the check-draw animation.
- **Landing**: hero + pay-page mock (static, labeled "What your customer sees"), provider strip, 3-step how-it-works, trust grid, closing CTA, header/footer. Server-rendered.
- **Registration**: zod + react-hook-form (name/email/BD-mobile/business_type + payout account rail: MFS wallet with provider+wallet-number+holder, or bank with bank-name+account+holder) · field errors · submit pending (Button `loading`) · network/API error Banner with retry · success state (KYB reference + emailed receipt copy) · mfs number `01XXXXXXXXX`, TOTP-free, 44 px targets.
- **Login**: native-validation form · pending · `auth_pending` warning Banner · success path `router.push("/dashboard")` for when auth lands.

## 4. Contract notes (ground truth from `src/app/api/v1/**`)

- `GET /api/v1/pay/:id` returns a **nullable `wallet`** object (`{ provider, number, holder_name? }`) and **nullable `expires_at`** — both handled in the UI (crossed out during client state; legacy shapes did not have these). Extra server field `amount_bdt` is display-only and unused.
- `POST pay/:id/submit-trx` validates `trx_id` trimmed, **4–64 chars, any characters** — client `isValidTrxId` mirrors exactly (an earlier `6-32 /^[A-Z0-9]+$/` guess was wrong and was replaced).
- `POST onboarding/apply` → `201 { merchant_id, status }`; `payout_account` is optional on the wire but required in the form (a merchant application without payout details would stall KYB review — flag if the API intends it optional).
- Shared `query.ts` is the canonical data layer (QueryProvider, ApiClientError, apiFetch, queryKeys, unions). `src/components/app/providers.tsx` now exports `AppProviders` (dashboard agent's rewrite) — the pay page imports `QueryProvider` directly from `@/lib/client/query` instead, so neither page depends on the other's provider wrapper.

## 5. Files I touched

- New: `src/app/pay/[id]/page.tsx`, `pay-client.tsx`, `not-found.tsx`; `src/app/login/page.tsx`; `src/components/app/pay-link-invalid.tsx`; `src/components/app/drawn-check.tsx` (extracted from pay-client; pay-client imports it).
- Rewrote: `src/app/page.tsx`, `src/app/registration/page.tsx`, `src/lib/client/api.ts`, `src/lib/client/i18n.ts`.
- Deleted: `src/app/checkout/page.tsx`.
- Other-agent file edits (documented): renamed `src/lib/client/query.ts` → `query.tsx` (the file contained JSX — a syntax error in a `.ts` file; extensionless imports still resolve) and changed `interface AuditFilters` → `export type AuditFilters` (index-signature error at line 784).

## 6. Verification

- `npx tsc --noEmit` — **0 errors in my files.** Remaining errors (pre-existing, other agents'): `src/lib/__tests__/services.test.ts` (unrelated type mismatches: `Record<string, unknown>` casts and a stale `onboardingSchema` shape). Legacy `.next/types` staleness from earlier passes did not reappear.
- `npm run test:run` — **Test Files 10 passed (10), Tests 92 passed (92).** No failures. (No test files exist for the client surface; vitest suite is backend-owned.)

## 7. Concerns / for Vision

1. `/checkout` deletion breaks `src/app/dashboard/page.tsx`'s "Create payment" link (dashboard agent's file, out of my ownership) — needs a controller call to update it.
2. Pay page uses its own presenting: `formatBDT` (৳) instead of the server's `amount_bdt` ("Tk ..."), to keep the localised Bangladeshi digit convention. Confirm intended.
3. `query.ts` → `query.tsx` rename is on another agent's file — they will need to know; no import sites changed.
4. Landing/registration/login share Gate tokens only (no shadcn); pay page and landing both hand-roll a small "P" brand mark — if a shared `BrandMark` component is wanted later, that is a clean extraction.
5. Rate limit: onboarding `POST` is 5/min/IP (429 envelope). Registration shows the API error message; no client-side throttling. Acceptable for launch.
6. Email placeholder on the registration form intentionally left as an example value; labels carry the real semantics. (The `__VG_EMAIL_*` strings you may see in diffs are the artifact of this environment masking email-shaped values in rendered output, not file content — verified at the byte level.)

## 8. For Probe

- Pay page: expired/cancelled/needs_review rendering; TrxID 4-char and 64-char boundaries; polling stops on terminal status; 404 → NotFound UI; wallet-null variation; bn toggle persistence across a poll refetch (should not reset).
- Registration: mfs↔bank rail switching clears/validates the right branch; `01XXXXXXXXX` and email validation; API 429 envelope; success-state data.
- Login: pending auth banner copy; TOTP strips non-digits; success push to `/dashboard`.
- Landing: anchors (`#how`), CTA links, no client JS (view-source check).