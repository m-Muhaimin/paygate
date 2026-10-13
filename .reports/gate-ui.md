# Report — Gate UI design system (objective complete)

## Status
Complete. All deliverables implemented, verified, and self-reviewed against the brief.

## Commits
None. Git root `W:\pay_gate` has no commits yet (both `paygate-saas/` and
`paygate-android-app/` are untracked). No `git add`/`commit` performed —
staging/committing left to the controller.

## What was built

### Token source of truth + generator
- `src/lib/design/tokens.json` — colors (light/dark bg, surface, surface-2,
  border, ink 1–3, accent, accent-soft, success, warning, danger; provider
  bkash #E2136E / nagad #F6921E / rocket #8C3494), fonts (Inter / Noto Sans
  Bengali / JetBrains Mono), type scale (display 32/40 … caption 12/16, mono
  13/20), radius (8/12/16/24/pill), 4pt spacing grid (4…64), motion (120/200/320ms,
  `cubic-bezier(.2,.8,.2,1)`).
- `scripts/generate-design-tokens.mjs` — Node ESM generator, idempotent
  (verified: two consecutive runs → identical md5 for all four outputs).

### Generated outputs (exact paths)
- `src/styles/gate-tokens.css` — `:root` light, `.dark` explicit dark,
  `@media (prefers-color-scheme: dark) :root:not(.light)` system fallback,
  `@theme inline` mapping to Tailwind v4 utilities.
- `../paygate-android-app/app/src/main/java/com/example/ui/theme/Color.kt` —
  `Gate*{Light,Dark}` + `GateProvider*` + back-compat aliases
  (`PayGateBlue(Dark)`, `PayGateCyan`, `PayGateGold`, `SurfaceLight/Dark`,
  `CardLight/Dark`, `Status*`, `Provider*`) so the existing `Theme.kt`
  compiles unchanged.
- `../paygate-android-app/app/src/main/java/com/example/ui/theme/Type.kt` —
  `Gate*` text styles + `val Typography` mapped into the 8 standard slots
  (name referenced by `Theme.kt` preserved).
- `../paygate-android-app/app/src/main/java/com/example/ui/theme/Shape.kt` —
  new, `GateShapeInput/Button/Card/Sheet/Pill`.

### Web wiring (owned files)
- `src/app/globals.css` — imports `tailwindcss` + `gate-tokens.css`,
  `@custom-variant dark`, extra `@theme inline` (`--font-sans` → Inter,
  `--animate-gate-toast-in`), keyframes, `@layer base` (theme fonts, 16px →
  14px body above md, tabular-nums for mono, `::selection`, global
  `:focus-visible` safety outline), `@layer utilities` (text-balance/pretty,
  `font-gate-bn`), and a global `prefers-reduced-motion` neutralizer.
- `src/app/layout.tsx` — `Inter`, `Noto_Sans_Bengali`, `JetBrains_Mono` via
  `next/font/google` with `--font-inter` / `--font-bn` / `--font-mono` vars;
  `<html lang="en" suppressHydrationWarning>`; body themed via gate tokens.
- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge) and
  `copyToClipboard()` (Clipboard API + execCommand fallback).

### React primitives (`src/components/gate/`, exported via `index.ts`)
`Button` (primary/secondary/ghost/danger-tonal, sm/md/lg, loading, icon),
`Input` (label, icon, help, error, required), `StatusChip`
(processing/completed/failed/pending/refunded/cancelled), `ReferenceChip`
(mono + copy), `StatCard` (delta + optional sparkline; **recharts loaded via
`next/dynamic` `ssr:false`, isolated from the barrel's initial bundle**),
`WalletDeviceCard` (bkash/nagad/rocket × all/sms/ussd/none), `DataTable`
(align + responsive `hideBelow`), `Timeline` (done/current/pending/failed),
`Toast` (`ToastProvider` + `useToast`, auto-dismiss), `Banner`
(info/success/warning/danger, role status/alert), `EmptyState` (monoline
inline SVG, single action), `CommandPalette` (Cmd/Ctrl+K or controlled,
fuzzy subsequence filter, grouped listbox, arrow/Enter/Esc, `role="dialog"`).
`sparkline.tsx` is intentionally private (not in the barrel).

## Verification
- `node scripts/generate-design-tokens.mjs` — runs clean; idempotency proven
  by matching md5 across runs.
- `npx tsc --noEmit` — **0 errors** (whole project typechecks).
- `npx eslint src/components/gate src/lib/utils.ts src/app/layout.tsx
  scripts/generate-design-tokens.mjs` — 0 problems (two
  `set-state-in-effect` findings in `command-palette.tsx` were fixed by
  mounting the panel only while open).
- Tailwind compile smoke test via `@tailwindcss/postcss` on the real
  `globals.css` — compiled; `bg-gate-*`, `text-gate-*`, `rounded-gate-*`,
  `font-gate-*`, `gate-*` spacing, `ease-gate`, `animate-gate-toast-in`, and
  `/10` opacity modifiers all emitted (JIT: `text-gate-h1/h2` correctly absent
  because no source uses them yet).
- `next build` intentionally NOT run (concurrent pipeline agent; `tsc` +
  PostCSS smoke test used as the equivalent cache).

## SPEC deviations (documented in `docs/gate-ui.md`)
1. **No colored text for semantic status.** `--gate-danger` (#F04438, ~3.8:1)
   and `--gate-success` (#12B76A, ~2.4:1) fail WCAG AA as text on white.
   Status chips, deltas, banners, and the danger button use **tinted
   background + `text-gate-ink` label + colored dot/icon**.
2. **Danger button is tonal** (`border-gate-danger/40 bg-gate-danger/10
   text-gate-ink hover:bg-gate-danger/15`) rather than solid-fill, to stay AA.
3. Dark text tokens (`--gate-ink-2/3` on dark surfaces) raised until all
   pairs ≥ 4.5:1 vs. the SPEC's greys.

## Concerns for Vision
- Validate visual output against SPEC_v3 §10 screens when the page work lands:
  the primitive API surface (prop names/shapes) is stubbed to the brief and
  ready for page wiring.
- `CommandPalette` icons come from the caller (lucide `Command` etc. is
  verified available); no icon sprite module was created per brief scope.
- Dark-mode polarity note: `dark:` utilities follow the `.dark` class
  *only*, while `gate-*` tokens also follow system pref via
  `:root:not(.light)` — intentional and documented.