# PayGate — Payment engine report

**Task:** implement the payment engine — SMS parse/ingest, matching, wallet assignment,
double-entry ledger, outbound webhooks — plus the device/SMS/webhook HTTP surface.
**Normative source:** `SPEC_v3.md` §1 (money/fee), §3 (states), §4 (matching), §5 (wallets),
§6 (ledger/balance), §7 (API), §8 (webhooks), §9 (balance continuity).
**Scope owned:** `src/lib/{sms,matching,wallets,ledger,webhooks}/**`,
`src/app/api/v1/{sms,devices}/**`, `src/app/api/v1/webhooks/[id]/resend/**`,
`src/lib/__tests__/{parser,matching,ledger,webhooks}.test.ts`, `src/lib/reference.ts`.
Deleted legacy `src/app/api/devices/**`.
**Untouched:** `src/app/api/v1/{plans,payments,pay,onboarding,balance,settlements,payouts,admin}/**`,
`src/components/**`, `src/lib/{db,api,domain}/**`, `supabase/**`, `package.json`.

---

## 1. Verification

| Command | Result |
|---|---|
| `npx vitest run` | **10 files, 115 tests passed** |
| `npx tsc --noEmit` (owned paths) | **0 errors** |
| `npx eslint <owned paths>` | **0 errors, 0 warnings** |

`tsc` still reports pre-existing errors in `src/lib/__tests__/services.test.ts` (another
agent's file — `Merchant`/`Payment`/`Wallet` missing an index signature). Not in my
ownership and not caused by this work.

Owned test files: `parser.test.ts` (10), `matching.test.ts` (15), `ledger.test.ts` (4),
`webhooks.test.ts` (3).

---

## 2. Files

| Path | What |
|---|---|
| `src/lib/sms/parser.ts` | `PARSER_VERSION`, per-provider regex table, `parseSms`, `parseAmountToPaisa`, `normalizePhone`, `detectProvider`, `extractTrxId`. |
| `src/lib/sms/ingest.ts` | `ingestSms` — dedupe, wallet resolution, AES-256-GCM raw encryption, flagging, match trigger. |
| `src/lib/matching/engine.ts` | `matchIncomingTxn`, `balanceContinuityBroken`, `MatchInput`/`MatchResult`/`MatchOutcome`. |
| `src/lib/ledger/post.ts` | `postPaymentPaid` — 3-legged balanced entry group. |
| `src/lib/ledger/balance.ts` | `availableBalance` → `merchant_balance` RPC. |
| `src/lib/wallets/assign.ts` | `assignWallet`, `shouldAutoDrain`, `DRAIN_THRESHOLD`. |
| `src/lib/wallets/pending.ts` | `pendingPaymentCount`, `activeWalletCount`. |
| `src/lib/webhooks/dispatch.ts` | `dispatchEvent`, `attemptDelivery`, `RETRY_SCHEDULE_SECONDS`, `nextRetryDelaySeconds`, `WebhookEventType`, `WebhookPayload`. |
| `src/lib/webhooks/retry.ts` | Re-exports + `RETRY_SCHEDULE` alias (cron/worker façade). |
| `src/lib/webhooks/sign.ts` | Re-exports `buildSignatureHeader` from `@/lib/api/crypto`. |
| `src/lib/webhooks/inspector.ts` | `listDeliveries`, `manualResend`. |
| `src/app/api/v1/sms/webhook/route.ts` | `POST` SMS ingest. |
| `src/app/api/v1/devices/pair/route.ts` | `POST` pairing-code → device token. |
| `src/app/api/v1/devices/heartbeat/route.ts` | `POST` liveness + config. |
| `src/app/api/v1/webhooks/[id]/resend/route.ts` | `POST` merchant manual resend. |
| `src/lib/reference.ts` | Re-export shim for `@/lib/domain/reference`. |

---

## 3. Contract signatures (other agents depend on these verbatim)

```ts
// src/lib/webhooks/dispatch.ts
type WebhookEventType = "payment.paid" | "payment.expired" | "payment.needs_review" | "payment.cancelled";
dispatchEvent(merchantId: string, type: WebhookEventType, payment: Payment): Promise<void>;
attemptDelivery(deliveryId: string): Promise<void>;
RETRY_SCHEDULE_SECONDS: number[];                    // [10,60,300,1800,7200,21600,86400]
nextRetryDelaySeconds(attempts: number): number | null;

// src/lib/ledger/post.ts
postPaymentPaid(payment: Payment): Promise<void>;

// src/lib/ledger/balance.ts
availableBalance(merchantId: string): Promise<number>;   // integer paisa

// src/lib/wallets/assign.ts
assignWallet(provider: Provider, merchantId: string): Promise<Wallet>;  // throws 503 no_wallet_available
shouldAutoDrain(wallet: Pick<Wallet,"today_total"|"daily_limit"|"monthly_limit">): boolean;
DRAIN_THRESHOLD: 0.8;

// src/lib/matching/engine.ts
interface MatchInput { provider: Provider; trx_id: string; wallet_id: string;
  amount: number; balance_after: number | null; ref_normalized: string | null; parser_version?: string; }
type MatchOutcome = "paid" | "needs_review" | "unmatched" | "duplicate";
interface MatchResult { outcome: MatchOutcome; paymentId?: string; matchedBy?: MatchedBy; reviewReason?: ReviewReason; }
matchIncomingTxn(txn: MatchInput): Promise<MatchResult>;
```

`@/lib/services/webhooks.ts` (another agent) lazy-imports `dispatchEvent` from
`@/lib/webhooks/dispatch` — this is satisfied.

---

## 4. HTTP surface

### `POST /v1/sms/webhook`
- Auth: device token (`authenticateDevice`). Rate limit: **60/min** (`sms_webhook`).
- Body: `{ sender, body, client_msg_id, received_at?, sim_slot?, ref_hint?, parser_version? }`.
- Replies (SPEC §7 exact bodies): `200 {stored:true}` · `200 {ignored:true}` ·
  `200 {duplicate:true}` · `422 {unparseable:true}` · `400 missing_fields|invalid_payload` ·
  `401` bad/missing/revoked device token · `429` rate limited.

### `POST /v1/devices/pair`
- Body `{ code }` → `200 {device_id, device_token}` (token plaintext returned once; only
  `hashSecret(token)` persisted on `devices.token_hash`).
- `400 code_required`, `401 invalid_pairing_code|pairing_code_used|pairing_code_expired`,
  `500 pairing_lookup_failed|device_create_failed|pairing_consume_failed`.

### `POST /v1/devices/heartbeat`
- Auth: device token. Patches `last_heartbeat_at` (+`battery`, `queue_depth`, `app_version`,
  `permissions` when present); replies `{server_time, allowed_senders, min_app_version}`.

### `POST /v1/webhooks/:id/resend`
- Auth: merchant key (`authenticateMerchant`), scoped by `merchant_id`.
- `200 {ok:true}` · `404 delivery_not_found` (foreign/absent id).

---

## 5. Behaviour

### Parse / ingest
- `PARSER_VERSION = "2026-10-13.1"`. Providers `bkash|nagad|rocket` (+`16216` sender alias).
- Reference rule (SPEC §2): exactly 8 chars, no `REF` prefix, charset
  `23456789ABCDEFGHJKMNPQRSTUVWXYZ` + check char. The SPEC example `REF934P923`
  normalizes to 7 chars → invalid → `refNormalized=null`, `refRaw` kept verbatim.
- `ingestSms` order: (1) dedupe on `client_msg_id` → `duplicate`; (2) provider from sender,
  else `unparseable`; (3) resolve wallet by `device_id` + `provider`, disambiguated by
  `sim_slot`; no wallet → `ignored`; (4) no TrxID → `unparseable`; (5) encrypt raw body
  (AES-256-GCM, `SMS_ENCRYPTION_KEY`) — absent/failed ⇒ `raw_unavailable` flag only;
  (6) insert (PK collision → `duplicate`); (7) best-effort `matchIncomingTxn`.
- Flags: `unparseable`, `raw_unavailable`, `ref_missing`, `balance_gap`.
- Unparseable-with-TrxID is still persisted (flagged) so operators can inspect it.

### Matching (SPEC §4, all cases tested)
- `flagBalanceGap` first (best-effort): `balance_after − amount ≠ previous balance_after`
  ⇒ append `balance_gap`.
- Rule 1 reference: a `paid` payment on that reference ⇒ `needs_review/duplicate_ref`;
  >1 live candidate ⇒ `needs_review/conflict`; 1 candidate ⇒ claim.
- Rule 2 TrxID fallback on `submitted_trx_id` when no reference hit.
- Reference + TrxID resolve to **different** payments ⇒ `conflict`.
- Claim guards (in order): `wrong_wallet` (wallet not in `offered_wallet_ids`),
  `late_payment` (status `expired` or past `expires_at`), `underpaid`, `overpaid`
  (exact paisa required), then atomic `claim_incoming_txn`; a lost race ⇒ `duplicate_ref`.
- Nothing matched ⇒ `unmatched` (left for an operator; no payment touched).
- Success side effects: payment → `paid`/`matched_by`/`paid_at`, `postPaymentPaid`,
  then `payment.paid`. Review side effects: payment → `needs_review` + `review_reason`,
  then `payment.needs_review`. Ledger/webhook failures are contained (the claim stands).

### Ledger
- `paid` posts one `entry_group` (= `payment.id`): debit `payin`=amount, credit
  `fee`=fee_amount, credit `merchant_payable`=net_amount. `amount = fee + net` ⇒ balanced.
- **Zero-value legs are omitted** (`ledger_entries.amount` is `check (amount > 0)`; a
  0-bps fee would otherwise violate the constraint). A wholly-zero payment posts nothing.
- Balances are always derived (`merchant_balance` RPC); never stored.

### Webhooks (SPEC §8)
- `dispatchEvent` writes a `webhook_deliveries` row (`status:pending`) then attempts once.
  No `callback_url` ⇒ row left `failed` with no network call.
- `attemptDelivery` = one signed POST (`PayGate-Signature` via `buildSignatureHeader`).
  2xx ⇒ `success`; failure ⇒ `pending` + `next_attempt_at` from the schedule, or `failed`
  once exhausted. No signing secret ⇒ **do not send unsigned**; mark `failed`.
- Retry schedule `10s,1m,5m,30m,2h,6h,24h` → then `failed` (manual resend available).

### Idempotency
- SMS replay: `client_msg_id` dedupe **and** PK `(provider,trx_id,wallet_id)` collision → `duplicate`.
- Payment claims: single atomic `claim_incoming_txn` — only one caller can win.
- Ledger: `entry_group = payment.id` is the natural idempotency key.
- Webhook resend: re-runs one attempt; safe to repeat.

---

## 5. Deviations

1. **`ingestSms` payload gains `device_id`** — required to resolve the receiving wallet
   (`wallets.device_id`); the route supplies it from `authenticateDevice`.
2. **SMS reply bodies** use `{stored:true}`/`{ignored:true}`/`{duplicate:true}` and
   `422 {unparseable:true}` (SPEC §7 literals) rather than the generic error envelope.
3. **Webhook signing secret = `merchants.webhook_secret_hash`.** The schema stores only a
   hash (one-way); there is no plaintext secret column. This is a stop-gap — a rotating
   plaintext webhook secret needs a schema change (see Concerns).
4. **Resend route** uses `getRequestId` + `errorResponse` + `throw notFound` rather than
   `withRequestId`, because Next.js 16 route params are async (`await ctx.params`).
5. **Zero-value ledger legs omitted** (see §4) to satisfy the `amount > 0` check.
6. **Deleted `src/app/api/devices/**`** (legacy stubs importing a mock `lib/supabase`,
   bypassing auth) — superseded by `src/app/api/v1/devices/**`; nothing referenced them.

---

## 6. Concerns / handoff

- **No retry worker is wired.** `attemptDelivery` + `RETRY_SCHEDULE` are ready, but
  nothing polls `webhook_deliveries` for `status='pending' AND next_attempt_at <= now()`.
  A cron/queue worker (pg_cron or a scheduled route) must call `attemptDelivery(id)` on
  due rows, else SPEC §8 ">=99% within 3 attempts" cannot be met.
- **Webhook secret gap (deviation 3).** `webhook_secret_hash` cannot be used as an HMAC
  key without also knowing the plaintext; a real signature requires storing a separate
  encrypted/plaintext secret. Recommend a `merchants.webhook_secret` column (dispatch to
  the `supabase` subagent) — otherwise merchant signature verification is unverifiable.
- **`SMS_ENCRYPTION_KEY` must be set in production**, else every row carries
  `raw_unavailable` and raw SMS bodies are not persisted.
- **Auto-drain** flips a wallet to `draining` at ≥80% of a limit inside `assignWallet`;
  confirm the intended trigger point (assignment vs. after each credit).
- `attemptDelivery` uses `fetch` with no explicit timeout; consider an `AbortSignal` cap.
- **Route overlap with the admin/developer surface.** My brief assigns
  `POST /v1/webhooks/:id/resend`. `.reports/dashboard-admin.md` proposes
  `GET /v1/webhooks/deliveries` and `POST /v1/webhooks/deliveries/:id/resend`. That is a
  different path shape — the controller should reconcile the two so only one resend route
  ships. `webhooks/inspector.ts` (`listDeliveries`, `manualResend`) exists to back the
  `GET`/developer variant if that is the chosen shape.
- **Unimported seams.** `src/lib/wallets/pending.ts` and `src/lib/webhooks/inspector.ts`
  currently have no callers in `src/**`; they are provided as the operator/dev-list seams
  above. `src/lib/reference.ts` is a re-export shim so the SPEC §2-named path exists
  (core-lib.md §10.1 left this to a controller call). Remove any of these if the
  controller prefers no unused exports.
- Pre-existing `tsc` errors in `src/lib/__tests__/services.test.ts` (not mine) should be
  fixed by that file's owner before a green `tsc` gate.

---

## 7. Files to verify

```
npx vitest run src/lib/__tests__/parser.test.ts src/lib/__tests__/matching.test.ts \
  src/lib/__tests__/ledger.test.ts src/lib/__tests__/webhooks.test.ts
npx tsc --noEmit
npx eslint src/lib/sms src/lib/matching src/lib/wallets src/lib/ledger src/lib/webhooks \
  src/app/api/v1/sms src/app/api/v1/devices src/app/api/v1/webhooks
```
