# SPEC v3.1 addendum — Enhanced Checkout / Confirm Flow (normative)

Supersedes the pay-page flow in SPEC_v3.md. Everything else in SPEC_v3.md still applies.

## A. Payments state machine
`created -> awaiting_payment -> confirming -> paid`; terminal: `expired`, `cancelled`, `needs_review`.
- `confirming`: set when `POST /v1/pay/:id/confirm` is accepted and no matching SMS is present yet.
New/updated `payments` columns: `success_url text`, `cancel_url text`, `confirm_attempts int not null default 0`, `confirmed_at timestamptz`, `locked_until timestamptz`.
`merchants.auto_confirm boolean not null default false`.
Extend the payments status CHECK to include `confirming`.

## B. Endpoints
- `POST /v1/payments` body adds optional `success_url`, `cancel_url` (redirect targets).
- `GET /v1/pay/:id` (public 10/min/IP) returns `{id,status,amount,provider,reference,wallet:{provider,number,holder_name},expires_at,success_url,cancel_url,attempts_remaining,trxid_required,review_reason}`.
- `POST /v1/pay/:id/confirm` (public 10/min/IP, Node runtime, `maxDuration` 120) body `{trx_id}`:
  1. Lockout: if `locked_until > now()` -> 429 `too_many_attempts`. If `confirm_attempts >= 5`, set `locked_until = now()+15min` and 429.
  2. Increment `confirm_attempts`, persist `submitted_trx_id` (format-validate: 6–24 alnum); if `awaiting_payment` -> `confirming`.
  3. Immediate check: run the matching engine; if a match/resolution is available now, return the final status (<1s).
  4. Else hold: poll the DB ~every 1s for up to 90s for a status change; also broadcast Supabase Realtime `payment:<id>` on change (best-effort).
  5. Return `{status, matched_by?, review_reason?, payment}`. On timeout -> `{status:'confirming'}` (UI: "still checking").
  6. Time window 15 min. Amount must match exactly; a mismatch flags `needs_review` (`underpaid`/`overpaid`). If SMS has a reference it must match (normalized, case-insensitive).
- `submit-trx` stays as a thin alias that only records `submitted_trx_id` (no hold).

## C. Auto-confirm (optional, per merchant)
If `merchants.auto_confirm` and an incoming SMS matches reference+amount+wallet+window, the engine marks `paid` without the customer pressing Confirm.

## D. Integration modes
- Redirect: create payment -> redirect to `pay_url`; on resolution redirect to `success_url`/`cancel_url`.
- Popup: `public/paygate.js` opens `pay_url` in an overlay iframe and relays `paid|needs_review|expired|closed` to the parent via `postMessage`. A redirect/event is NEVER proof of payment; merchants must use the `payment.paid` webhook or `GET /v1/payments/:id`.

## E. Security / edge cases
- UI does basic TrxID format validation; 5 failed attempts lock the page 15 min (server-enforced via `confirm_attempts`/`locked_until`).
- Never reveal another customer's TrxID.
- Late SMS on an expired payment -> `needs_review` (`late_payment`).
- Duplicate SMS ignored via `client_msg_id` dedupe.
