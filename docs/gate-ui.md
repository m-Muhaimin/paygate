# Gate UI — design system

PayGate's product design system: one token source of truth plus a generator
that emits Tailwind v4 CSS tokens (web) and Compose tokens (Android), and a
typed React primitive library in `src/components/gate/`.

## Token source of truth

- **`src/lib/design/tokens.json`** — the single source of truth: colors
  (light + dark + provider accents), fonts, type scale, radius, spacing
  (4pt grid), motion.
- **`scripts/generate-design-tokens.mjs`** — generates:
  - `src/styles/gate-tokens.css` (web, hand-edit **disabled**)
  - `../paygate-android-app/app/src/main/java/com/example/ui/theme/Color.kt`
  - `../paygate-android-app/app/src/main/java/com/example/ui/theme/Type.kt`
  - `../paygate-android-app/app/src/main/java/com/example/ui/theme/Shape.kt`

Regenerate after editing tokens.json:

```bash
node scripts/generate-design-tokens.mjs
```

The generator is idempotent (verified: two consecutive runs produce byte-identical output).

## Web tokens

`src/styles/gate-tokens.css` is imported by `src/app/globals.css`. Values are
defined as CSS custom properties (`--gate-*`) and mapped into Tailwind's theme
via `@theme inline`, which makes these utilities available:

| Kind | Example utilities |
| --- | --- |
| Color | `bg-gate-surface-2`, `text-gate-ink-2`, `border-gate-border`, `bg-gate-accent-soft` |
| Provider | `bg-gate-provider-bkash`, `text-gate-provider-nagad`, `bg-gate-provider-rocket` |
| Font | `font-gate-ui` (Inter), `font-gate-bn` (Noto Sans Bengali), `font-gate-mono` (JetBrains Mono) |
| Type | `text-gate-display`, `text-gate-h1`…`h3`, `text-gate-body`, `text-gate-body-mobile`, `text-gate-caption`, `text-gate-mono` (each with line-height baked in) |
| Radius | `rounded-gate-input` (8), `rounded-gate-button` (12), `rounded-gate-card` (16), `rounded-gate-sheet` (24), `rounded-gate-pill` |
| Space | `p-gate-16`, `gap-gate-12`, `mt-gate-8`… (4pt grid) |
| Motion | `ease-gate`, `duration-[120ms] / [200ms] / [320ms]` |
| Effects | `animate-gate-toast-in` |

### Dark mode

- **Class strategy** — add `class="dark"` to `<html>` for explicit dark mode;
  `dark:` utilities follow the class (via `@custom-variant dark`).
- **System fallback** — tokens also flip via
  `@media (prefers-color-scheme: dark) { :root:not(.light) }`, and the app
  opts out with `class="light"`.
- Outcome: components using only `gate-*` tokens adapt to both class-dark and
  system-dark; `dark:` utilities respond to the class only. Documented because
  the two sources can diverge mid-session.

## React primitives (`src/components/gate/`)

Export from `@/components/gate` (barrel `index.ts`):

| Component | Usage |
| --- | --- |
| `Button` | Variants `primary` / `secondary` / `ghost` / `danger` (tonal), sizes `sm` / `md` / `lg`, `isLoading`, `leftIcon` |
| `Input` | Labeled input, `icon`, `help`, `error`, `required` |
| `StatusChip` | `PaymentStatus` = `processing` | `completed` | `failed` | `pending` | `refunded` | `cancelled`; tinted bg + colored dot + ink label (AA) |
| `ReferenceChip` | Mono reference id + copy button (`copyToClipboard` in `@/lib/utils`) |
| `StatCard` | Delta direction/color + optional sparkline (recharts, lazy via `next/dynamic`, **not** in the barrel's initial bundle) |
| `WalletDeviceCard` | `WalletProvider` = `bkash` | `nagad` | `rocket`; `DevicePermission` = `all` | `sms` | `ussd` | `none` |
| `DataTable` | Generic columns (`header`, `cell`, `align`, `hideBelow`), caption, `empty` slot |
| `Timeline` | Status per step: `done` / `current` / `pending` / `failed`; shaded connectors on dark |
| `Toast` | `ToastProvider` + `useToast({ title, variant })`; `variant` = `info` | `success` | `warning` | `danger`; auto-dismiss, reduced-motion aware |
| `Banner` | `variant` info/success/warning/danger; `title`, `description`, `action`, `onDismiss`; `role="status"` / `role="alert"` |
| `EmptyState` | `title`, `description`, one `action`; monoline inline SVG illustration |
| `CommandPalette` | Controlled `open`/`onOpenChange` (or Cmd/Ctrl+K), fuzzy subsequence filter over `items[{id,label,keywords?,group?,icon?,hint?,onSelect}]`, grouped, arrow/Enter/Esc nav, `role="dialog"` + combobox/listbox semantics |

### Accessibility decisions

- **No colored text for meaning.** `--gate-danger` ≈ 3.8:1 and
  `--gate-success` ≈ 2.4:1 on white fail WCAG AA as text. Status chips, delta
  chips, banners, and the `danger` button therefore use a **tinted background
  + ink text + colored glyph** pattern instead of colored text.
- Danger button is **tonal**: `border-gate-danger/40 bg-gate-danger/10
  text-gate-ink hover:bg-gate-danger/15` — preserves AA while reading as
  destructive.
- All interactive elements ≥ 44px, visible `focus-visible` rings
  (`ring-gate-accent`), `prefers-reduced-motion` neutralized globally in
  `globals.css`, tabular numerals applied to mono/code/stat values.
- Dark token pairs re-checked: ink/ink-2/ink-3 on surface/surface-2 all ≥ 4.5:1.

## Android parity

Generated Compose files keep the names `Theme.kt` already references:
`PayGateBlue`, `PayGateBlueDark`, `PayGateCyan`, `PayGateGold`,
`SurfaceLight`/`SurfaceDark`, `CardLight`/`CardDark`, `Status*`,
`ProviderBkash`/`ProviderNagad`/`ProviderRocket`, and `val Typography`
(assigned to the new `Gate*` values). `Shape.kt` is new and unused until
adopted.