# Report — Merchant dashboard + admin console (objective complete)

## Status
Complete. All 12 application screens plus the shared client layer are implemented
and wired to the assumed `/v1` contract. `npx eslint` runs clean on owned files
(**0 errors, 4 informational warnings**); `npx tsc --noEmit` reports **0 errors in
owned files**.

## Commits
None. Git root `W:\pay_gate` has no commits; no `git add`/`commit` performed.
Staging is left to the controller.

## What was built

### App shell + routing (`src/app/(app)/`)
- `layout.tsx` — server layout. Inlines a `THEME_BOOTSTRAP` script that applies
  `.dark`/`.light` on `<html>` before paint from `localStorage["paygate-theme"]`
  (falls back to `prefers-color-scheme`), then wraps children in
  `<AppProviders>` (TanStack Query + Toast) and `<AppShell>`. The storage key
  matches `theme-toggle.tsx` exactly.
- Routes (all `page.tsx`): `dashboard`, `payments`, `plans`, `settlements`,
  `developers`, `settings`, `admin/{fleet,wallets,review,payouts,merchants,audit}`.
- Deleted the legacy route stubs that predated the SPEC layout:
  `src/app/dashboard`, `src/app/devices`, `src/app/reconciliation`,
  `src/app/payments`.

### Shared client layer
- `src/lib/client/query.tsx` (820 lines) — the single client data layer:
  typed domain models, `ApiError` + error-envelope parsing
  (`{ error: { code, message, request_id } }`), `apiFetch`/`apiList`/`apiItem`
  helpers, `queryKeys` factory, every fetcher/mutator, and `QueryProvider`
  defaults (no retry on 4xx, single retry on 5xx).
- `src/components/app/` — supporting UI: `app-shell`, `nav`, `ui` (Card,
  PageHeader, StatusPill, KeyValue, JsonBlock, ProviderBadge,
  PaymentStatusBadge, GenericStatus, CopyButton…), `skeleton`, `states`
  (`ErrorState`, `TableEmpty`, `ListRegion`), `drawer`, `payment-table`,
  `payment-drawer`, `form-controls` (`Textarea`, `Switch`), `format`
  (`formatBdt`, `formatCount`, `formatRelative`, `isLive`, `paisaFromInput`,
  `MIN_PAYOUT_PAISA = 100000`), `theme-toggle`, `providers`.

### Merchant screens
- **Overview** (`dashboard/page.tsx`): balance + payments + device queries;
  `buildTrend` derives a 7-day paid-net series, today's total, and a
  vs-yesterday delta; attention queue (awaiting payment, needs-review,
  unmatched, offline devices); latest payments via `PaymentTable` +
  `PaymentDrawer`.
- **Payments** (`payments/page.tsx`): status filter + search, paged
  `PaymentTable`, row click opens `PaymentDrawer` with timeline, wallet,
  reference, cancel mutation.
- **Plans** (`plans/page.tsx`): RHF + zod (`planSchema.superRefine` for
  fixed-amount vs open min/max ranges), create/edit drawer, edit-as-new-version
  with an info `Banner`, archive action.
- **Settlements** (`settlements/page.tsx`): balance `KeyValue` grid,
  statements table, CSV export (`settlementsExportUrl({format:"csv"})` →
  `window.location.href`), payout request card (bank/mfs rails, min Tk 1,000 =
  100000 paisa, over-available guard disables submit), payout history.
- **Developers** (`developers/page.tsx`): create API key drawer (label +
  live/test `Switch`, plaintext key shown once), keys table (masked, copy,
  revoke), webhook secret card + rotate (new secret shown once), webhook
  delivery inspector with Resend, cURL/JS code samples.
- **Settings** (`settings/page.tsx`): profile/payout-account form (RHF + zod,
  bank/mfs), team list with role + 2FA pills.

### Admin screens
- **Fleet** (`admin/fleet/page.tsx`): pairing-code generation + countdown,
  bound devices joined `wallet.device_id → device` rendered as
  `WalletDeviceCard` with liveness, flush/revoke mutations, "other devices"
  table.
- **Wallets** (`admin/wallets/page.tsx`): create/edit drawer (msisdn pattern
  `^01\d{9}$`, daily/monthly limits, concurrency cap, status), clickable table.
- **Review** (`admin/review/page.tsx`): split list/detail, reason copy map,
  candidate selection, resolve (`matched`/`accepted`/`rejected`, note required
  for reject), invalidates review + audit; selection is *derived* (a missing
  selection falls back to the first case) rather than effect-driven.
- **Payouts** (`admin/payouts/page.tsx`): status filter, pending-total header,
  approve/reject decision drawer (note required for reject), maker-checker
  `Banner`.
- **Merchants** (`admin/merchants/page.tsx`): merchant table + KYB decision
  drawer (note required for reject), risk-tier pills.
- **Audit** (`admin/audit/page.tsx`): filter form (q/actor/action/entity)
  applied on submit, table → detail drawer with before/after `JsonBlock`.

## State handling
Every list/table renders four states: pending (skeleton), error (`ErrorState`
with retry), empty (`TableEmpty` / a table `emptyState` node), and data. Every mutation
disables its trigger while pending (`loading`), surfaces `ApiError.message`
inline in forms, and toasts on success. Forms validate with zod before submit;
the payout/review/KYB forms enforce "note required on reject".

## Endpoint contract

### Called as specified (SPEC_v3 §7)
`/v1/balance`, `/v1/plans` (GET/POST/PATCH), `/v1/payments` (GET, GET/:id,
POST /:id/cancel), `/v1/settlements`, `/v1/payouts` (GET/POST), and the admin
family `/v1/admin/{wallets,devices,review,payouts,merchants,audit}`.

### Gaps — for Wired (not in SPEC_v3 §7; assumed shapes)
| Route | Used by |
| --- | --- |
| `GET /v1/merchants/me` | shell badge, settings |
| `PATCH /v1/merchants/me` | settings profile + payout account |
| `GET /v1/api-keys`, `POST /v1/api-keys`, `POST /v1/api-keys/:id/revoke` | developers |
| `POST /v1/merchants/me/webhook-secret/rotate` | developers |
| `GET /v1/webhooks/deliveries`, `POST /v1/webhooks/deliveries/:id/resend` | developers (SPEC mentions "manual Resend" but no route) |
| `GET /v1/settlements/export?format=csv` | settlements |
| `GET /v1/merchants/me/team` | settings |
| `POST /v1/admin/devices/pairing-code` (admin variant of `POST /v1/devices/pair`) | fleet |
| `POST /v1/admin/devices/:id/{revoke,flush}` | fleet |
| `POST /v1/admin/review/:id/resolve` | review |
| `POST /v1/admin/merchants/:id/kyb` | merchants |

Money is `int` paisa everywhere; lists are read as `{ data: [...] }` and single
objects as either a bare object or `{ data: {...} }` (`apiItem` tolerates both).

## Verification
- `npx tsc --noEmit` → 0 errors in owned files. Remaining project errors are
  confined to `src/app/registration/page.tsx` and
  `src/lib/__tests__/services.test.ts` — both owned by other agents.
- `npx eslint "src/app/(app)/**/*.{ts,tsx}" "src/components/app/**/*.{ts,tsx}"
  "src/lib/client/query.tsx"` → **0 errors, 4 warnings**. The 4 warnings are
  `react-hooks/incompatible-library` "Compilation Skipped" notices emitted for
  `react-hook-form`'s `form.watch` in `plans`, `settings`, `settlements`,
  `admin/wallets` — expected noise from the React Compiler rule, not defects.
- Fixed this session (lint-clean pass): removed `setState`-in-effect findings by
  switching to the documented "adjust state when props change" pattern
  (`developers` key drawer, `admin/merchants`, `admin/payouts`, `admin/review`
  detail) and deriving review selection; removed unused imports
  (`dashboard` `errorMessage`/`cn`, `developers` `Textarea`, `review`
  `GenericStatus`); stabilized the dashboard `useMemo` dependency.
- No `next dev`/`next build` run (shared workspace with a concurrent pipeline
  agent); `tsc` + `eslint` were used as the compile gate, matching the sibling
  `gate-ui` report.

## Resolved / concerns
- **Resolved:** an earlier concern about `checkout/page.tsx` pushing to a
  deleted `/payments/:id` is now moot — `src/app/checkout` no longer exists and
  the public pay flow lives at `src/app/pay/[id]` (matches SPEC `/v1/pay/:id`).
  No dashboard route links to a nonexistent `/payments/:id`; verified the only
  internal nav href is `/payments` (exists).
- **For Vision:** confirm the visual composition of each screen against
  SPEC_v3 §10; the pages consume the `gate` primitives and `app` support
  components as-is, with no local restyling.
- **For Probe:** the highest-value flows to exercise in a browser are
  payout request (min/over-available boundaries), plan edit-as-new-version,
  review resolve (note-required reject), KYB decision, API-key create (one-time
  plaintext) and webhook-secret rotate (one-time secret).
