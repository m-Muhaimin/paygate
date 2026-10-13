# PayGate — bKash / Nagad / Rocket SaaS

Merchant-facing SaaS for accepting Bangladeshi wallet payments **without any provider API**.
Customers pay via their wallet app → SMS confirmation lands on merchant's phone → Android app forwards SMS to PayGate → PayGate matches TrxID → marks payment paid → HMAC webhook to merchant.

## Features

| Area | What you get |
|------|--------------|
| **Checkout** | Create payments, get wallet number + TrxID instructions |
| **Dashboard** | Real-time payment stats, device health, recent activity |
| **Devices** | Pair/manage Android SMS forwarder phones |
| **Reconciliation** | Transaction log with manual match/fail actions |
| **Registration** | KYC-ready business onboarding (TIN, NTRC, contact details) |
| **Gateway API** | `/v1/payments`, `/v1/sms/webhook`, HMAC-signed callbacks |

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Lucide icons
- **Backend**: Next.js API routes, Supabase (PostgreSQL) with lazy client
- **Mobile**: Android (Kotlin + Jetpack Compose) — see `../PRD_SMS_Forwarder_APP.md`
- **Infra**: Designed for Vercel + Supabase; self-hostable on any Node host

## Quick Start

```bash
# 1. Install dependencies
cd paygate-saas
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Generate secrets: openssl rand -hex 32 (for MERCHANT_API_KEY, DEVICE_SECRET, WEBHOOK_SECRET)

# 3. Set up Supabase
# Run supabase-schema.sql in the Supabase SQL Editor

# 4. Run dev server
npm run dev
# Open http://localhost:3000
```

## Project Structure

```
paygate-saas/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Landing page
│   │   ├── checkout/page.tsx        # Create payment
│   │   ├── dashboard/
│   │   │   ├── page.tsx             # Stats + devices + recent
│   │   │   └── payments/page.tsx    # All payments table
│   │   ├── payments/[id]/page.tsx   # Payment detail + verify
│   │   ├── devices/page.tsx         # Device management
│   │   ├── reconciliation/page.tsx  # Transaction log
│   │   ├── registration/page.tsx    # Merchant KYC
│   │   └── api/
│   │       ├── payments/route.ts    # POST/GET payments
│   │       └── contact/route.ts     # Lead capture
│   ├── lib/
│   │   └── supabase.ts              # Lazy Supabase client
├── supabase-schema.sql              # Complete DB schema
├── .env.example                     # Environment template
└── next.config.ts                   # Minimal config (no turbopack)
```

## Gateway Contract (for Android app)

```
POST   /api/payments           # Merchant creates payment
POST   /v1/sms/webhook         # Android app pushes wallet SMS
GET    /v1/payments/:id        # Status polling
```

**Auth**: Bearer tokens (`MERCHANT_API_KEY` for merchants, `DEVICE_SECRET` for devices).  
**Webhook signing**: `x-signature: sha256=HMAC-SHA256(WEBHOOK_SECRET, body)`

## Database (Supabase / Postgres)

Tables:
- `payments` — all payment records (id, amount, status, TrxID, timestamps)
- `incoming_txns` — raw SMS payloads from devices (deduped on provider+trx_id)
- `devices` — paired Android phones with token hashes
- `merchants` — business KYC + API keys

Indexes on `status`, `provider`, `expires_at`, `submitted_trx_id`, `sender` for fast lookups.

## Deployment

### Vercel (recommended)
1. Push to GitHub
2. Import in Vercel → add env vars from `.env.example`
3. Deploy — API routes become serverless functions

### Self-hosted
```bash
npm run build
npm start
# Runs on port 3000; put behind nginx + systemd
```

## Android SMS Forwarder

The companion app is specified in `../PRD_SMS_Forwarder_APP.md`:
- QR-code pairing with dashboard
- Foreground service + WorkManager for reliability
- Sender allowlist, idempotent delivery, heartbeat
- Direct APK distribution (Play Store restricts SMS permission)

## License

MIT — Built for Bangladeshi merchants.
