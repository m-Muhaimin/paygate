# PayGate Platform — SPEC v3.0 (normative build contract)

Source: PRD v3.0 (13 Oct 2026). This file is the single build contract for all agents.
Repo: `W:\pay_gate\paygate-saas` — Next.js 16 App Router, React 19, TS strict, Tailwind v4, Supabase JS v2 + Postgres, zod 3.
Shell: win32, bash, non-interactive (no TTY/editors/pagers).

## 0. Resolved decisions (v3)
- Fee model: **5% per paid transaction**. Stored `fee_rate_bps = 500` on merchant. `fee_amount = round(amount * fee_rate_bps / 10000)` (nearest paisa). `net_amount = amount - fee_amount`. 5% is **deducted from merchant proceeds, NOT added to customer price**.
- Payout rails: **bank account or MFS wallet** (bKash/Nagad/Rocket) registered on the merchant payout account. **Minimum payout threshold = Tk 1,000 (100000 paisa)**; smaller balances accumulate.
- Reference: **exactly 8 characters total, NO "REF" prefix** (parser locates the value by the `Ref` label in the SMS).
- Hosting region: **Supabase Singapore** (default until legal review says otherwise).

## 1. Money & time conventions
- All amounts = **integer paisa** (BDT × 100). Never floats in DB.
- DB time = `timestamptz`. API time = ISO-8601 UTC strings.
- IDs = text, prefixed: `mer_`, `plan_`, `pay_`, `wal_`, `dev_`, `itx_`, `led_`, `set_`, `po_`, `whd_`, `aud_`, `evt_`, `key_`.
- Providers: `bkash`, `nagad`, `rocket`.

## 2. Reference algorithm (single source of truth: `src/lib/reference.ts`)
- Charset (31 chars, no look-alikes 0 O 1 I L): `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (digits 2-9 = 8, letters A-Z minus O,I,L = 23).
- Format: 7 random charset chars + 1 check char = 8 total.
- Check char: `checksum = Σ_{i=0..6} (charsetIndex(c_i)+1) * (i+1)`; `check = charset[checksum % 31]`.
- `normalizeReference(s)`: uppercase, strip spaces/hyphens/punctuation, remove a leading `REF` token if present.
- `isValidReference(s)`: normalized length == 8, all chars in charset, check char matches.
- Properties: single-use, never reused, unique (DB unique index), matched case-insensitively after normalisation.
- Parser accepts any 6..20 char token after the `Ref` label, then the server validates length + check char; failures go to the unmatched pool.

## 3. Payment state machine
`created → awaiting_payment → paid`; terminal: `expired`, `cancelled`, `needs_review`.
review_reason values: `underpaid`, `overpaid`, `wrong_wallet`, `late_payment`, `duplicate_ref`, `conflict`, `unmatched`.
matched_by values: `reference`, `trxid`.

## 4. Matching rules (first rule with exactly ONE candidate wins; each runs in ONE DB transaction on an unclaimed incoming txn)
1. **Reference**: normalized SMS ref == pending payment.reference, AND amount, provider, receiving wallet (∈ offered_wallet_ids) and time window all agree → `paid`, matched_by=`reference`.
2. **TrxID fallback**: customer `submitted_trx_id` == SMS `trx_id` with same amount, provider, wallet, window → `paid`, matched_by=`trxid`.
3. Otherwise unmatched pool or needs_review.
Cases: amount mismatch→needs_review(underpaid|overpaid); wrong provider or wallet not offered→wrong_wallet; payment expired→late_payment; ref already claimed→duplicate_ref (funds still received); unknown ref→unmatched pool (check char gives a *suggested* near-match, never auto-applied); ref+trxid point to different payments→conflict; same SMS twice→duplicate by client_msg_id (no second claim); wallet phone offline→payment stays awaiting_payment.

## 5. Wallet assignment (`src/lib/wallets/`)
- Pick active wallet for provider whose phone heartbeat < 3 min old, with limit headroom, and fewer pending payments than concurrency cap; least recently assigned; else **503 no_wallet_available**.
- `offered_wallet_ids` on payment; matching accepts any of them.
- `draining` wallets get no new payments; wallets > 80% of a limit auto-drain.

## 6. DB schema (Supabase migrations under `supabase/migrations/`)
Tables (timestamptz, integer paisa, prefixed text PKs, RLS on merchant_id):
- `merchants`: id, name, status, kyb_status, payout_account (jsonb: type bank|mfs, provider, account_no, holder, bank_name), fee_rate_bps (default 500), risk_tier, webhook_secret_hash, created_at.
- `pricing_plans`: id, merchant_id, name, amount, currency(default BDT), external_sku, version(int), status(active|archived), open_amount(bool default false), min_amount, max_amount, created_at.
- `wallets`: id, provider, msisdn, holder_name, device_id, sim_slot, status(active|draining|disabled), daily_limit, monthly_limit, today_total, last_assigned_at, created_at.
- `devices`: id, name, model, app_version, token_hash, status(active|revoked), last_heartbeat_at, battery, queue_depth, permissions(jsonb), created_at.
- `payments`: id, merchant_id, plan_id, plan_snapshot(jsonb), order_id, provider, wallet_id, offered_wallet_ids(text[]), amount, fee_amount, net_amount, reference(unique), status, review_reason, matched_by, submitted_trx_id, idempotency_key, callback_url, metadata(jsonb), expires_at, paid_at, created_at. Indexes: (reference), (merchant_id,status,created_at).
- `incoming_txns`: provider, trx_id, wallet_id, amount, balance_after, ref_raw, ref_normalized, raw (text, app-level encrypted), client_msg_id, sim_slot, claimed_payment_id, flags(text[]), received_at, created_at. PK (provider, trx_id, wallet_id). Index (ref_normalized).
- `ledger_entries`: id, merchant_id, payment_id, account (payin|fee|merchant_payable|payout|refund), direction(debit|credit), amount, entry_group, created_at. Double entry; balances always computed.
- `settlements`: id, merchant_id, period_start, period_end, gross_amount, fee_amount, net_amount, status, created_at.
- `payouts`: id, merchant_id, amount, rail(bank|mfs), destination(jsonb), status(requested|approved|rejected|paid), requested_by, approved_by, approved_at, created_at.
- `webhook_deliveries`: id, merchant_id, payment_id, event_type, event_id, url, payload(jsonb), status(pending|success|failed), attempts, next_attempt_at, last_status_code, created_at.
- `audit_log`: id, actor, action, entity_type, entity_id, before(jsonb), after(jsonb), ip, created_at.
- `merchant_users`: id, merchant_id, auth_user_id(uuid, Supabase Auth), role(owner|staff|developer|viewer), email, created_at.
- `api_keys`: id, merchant_id, key_hash, prefix(sk_live_|sk_test_), label, created_at, revoked_at, last_used_at.
- `device_pairing_codes`: code, merchant_id, expires_at, used_at, created_at.

Extension: `pgcrypto` (gen_random_uuid). RLS enabled on merchant-scoped tables.
DB helper functions (atomic, `supabase/migrations/*_functions.sql`):
- `assign_wallet(p_provider text, p_merchant_id text) returns wallets` — active, heartbeat<3min, headroom, concurrency cap, least recently assigned; sets last_assigned_at.
- `claim_incoming_txn(p_provider, p_trx_id, p_wallet_id, p_payment_id) returns boolean` — atomic claim where claimed_payment_id is null.

## 7. API surface (Next.js Route Handlers under `src/app/api/v1/`)
Merchant key (`sk_live_`/`sk_test_`, hashed) unless noted:
- `POST/GET /v1/plans`, `PATCH /v1/plans/:id` (edit = new version; archive).
- `POST /v1/payments` (Merchant key + `Idempotency-Key`): body `{ plan_id, order_id, provider, callback_url?, metadata? }` → `{ id, amount, reference, wallet{provider,number,holder_name}, pay_url, expires_at, status }`.
- `GET /v1/payments`, `GET /v1/payments/:id`, `POST /v1/payments/:id/cancel`.
- `GET /v1/pay/:id`, `POST /v1/pay/:id/submit-trx` — **public, rate limited (10/min/IP)**.
- `GET /v1/balance`, `GET /v1/settlements`, `POST /v1/payouts` — merchant key (payout needs balance ≥ Tk 1,000).
- `POST /v1/devices/pair` (pairing code) → device token.
- `POST /v1/sms/webhook`, `POST /v1/devices/heartbeat` (device token) — ingest 60/min.
- `/v1/admin/*` (staff session + 2FA): wallets, devices, review queue, KYB, payout approvals.
SMS webhook replies: `200 {stored}` | `200 {ignored}` | `200 {duplicate}` | `401 revoked` | `422 unparseable` (kept+flagged) | `429`/`5xx` retry.
Errors: JSON `{ error: { code, message, request_id } }`. `503 no_wallet_available`.
Structured logs with `request_id`.

## 8. Merchant webhooks (outbound, `src/lib/webhooks/`)
Events: `payment.paid`, 
`payment.expired`, `payment.needs_review`, `payment.cancelled`. Payload: `{ event_id, type, reference, plan_id, matched_by, net_amount, settlement_status, payment }`.
Header `PayGate-Signature: t=<unix>,v1=<hex>`; `v1 = HMAC-SHA256(secret, t + "." + rawBody)`. Verify rejects t older than 5 min.
Retries: 10s, 1m, 5m, 30m, 2h, 6h, 24h then `failed` with manual Resend. `GET /v1/payments/:id` is source of truth.

## 9. Security
Supabase Auth roles: owner, staff, developer, viewer. Mandatory 2FA for owner + staff. API keys hashed at rest. Device tokens 256-bit random, hashed, rotate 90d. Webhook secrets rotate with 24h overlap.
Spoof defence: sender allowlist at phone; server enforces unique (trx_id,wallet), single-use refs, balance continuity (balance_gap), per-provider format fingerprints, velocity limits, optional high-value confirm.
Privacy: raw SMS encrypted at rest, redacted after 90 days; customer numbers masked with audited reveal.

## 10. Gate UI design system (tokens.json -> Tailwind/CSS/Android)
Tokens (light / dark): bg #FAFAF9/#0B0B0E; surface #FFFFFF/#141418; surface-2 #F4F4F2/#1C1C22; border #E7E7E3/#2A2A31; ink #0E0E11/#F5F5F7; ink-2 #55555E/#A4A4AE; ink-3 #8A8A94/#6F6F7A; accent #5B5BF0/#8B8BFF; accent-soft #EEEEFF/#23234A; success #12B76A/#32D583; warning #F79009/#FDB022; danger #F04438/#F97066. Provider dots: bKash #E2136E, Nagad #F6921E, Rocket #8C3494.
Type: Inter (UI), Noto Sans Bengali (+10% line-height), JetBrains Mono (TrxID/ref/keys/amounts). Scale: Display 32/40, H1 24/32, H2 20/28, H3 16/24, Body 14/22 (16 mobile), Caption 12/16, Mono 13/20; tabular numerals for money.
Shape: 4pt grid; radius 8 inputs/chips, 12 buttons, 16 cards, 24 sheets, full pills; hairlines not shadows; one soft popover elevation.
Motion: 120ms hover, 200ms state, 320ms sheets, cubic-bezier(.2,.8,.2,1); honour prefers-reduced-motion.
Components: Button, Input, StatusChip, ReferenceChip, StatCard, DataTable, WalletDeviceCard, Timeline, Toast/Banner/EmptyState, CommandPalette (Cmd+K).
Screens: Hosted pay page (mobile-first, >=360px, <150KB, wallet+amount+ref with copy, countdown, live status, TrxID fallback, EN/Bangla); Merchant dashboard (Overview/Payments/Plans/Settlements/Developers/Settings); Admin console (Fleet/Wallet pool/Review queue/Payouts/Merchants/Audit log).
A11y: WCAG 2.2 AA, 44px targets, visible focus, keyboard, screen-reader labels, status never colour-alone.

## 11. Operational targets
SMS->paid p95 < 5s; reference match rate >= 95%; reference coverage >= 90%/provider; needs_review < 1%; webhook success >= 99% within 3 attempts; API p95 < 800ms; 99.9% uptime.
