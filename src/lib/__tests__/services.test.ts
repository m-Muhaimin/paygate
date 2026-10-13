/**
 * Endpoint + service tests for the merchant plans / payments / onboarding surface.
 *
 * The DB is mocked at the `db()` / `assignWallet()` boundary, so each test drives
 * the *real* service and *real* route handler (auth → validation → service → JSON)
 * and asserts on the observable HTTP contract and on the rows written to Postgres.
 *
 * Run: `npx vitest run src/lib/__tests__/services.test.ts`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, assignWalletMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  assignWalletMock: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: () => ({ from: fromMock, rpc: vi.fn() }),
  isPrivileged: () => true,
  dbAsUser: vi.fn(),
}));

vi.mock("@/lib/db/rpc", () => ({
  assignWallet: assignWalletMock,
  claimIncomingTxn: vi.fn(),
  merchantBalance: vi.fn(),
}));

import { POST as createPaymentRoute, GET as listPaymentsRoute } from "@/app/api/v1/payments/route";
import { POST as cancelPaymentRoute } from "@/app/api/v1/payments/[id]/cancel/route";
import { GET as getPaymentRoute } from "@/app/api/v1/payments/[id]/route";
import { GET as payPageRoute } from "@/app/api/v1/pay/[id]/route";
import { POST as submitTrxRoute } from "@/app/api/v1/pay/[id]/submit-trx/route";
import { POST as applyRoute } from "@/app/api/v1/onboarding/apply/route";
import { updatePlan, createPlan } from "@/lib/services/plans";
import { cancelPayment, createPayment, getPayPage, submitPaymentTrx } from "@/lib/services/payments";
import { applyForMerchant } from "@/lib/services/onboarding";
import type { Merchant, Payment, PricingPlan, Wallet } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// PostgREST-builder stand-in: one config per table, results selected by op.
// ---------------------------------------------------------------------------

interface Err {
  code?: string;
  message?: string;
  details?: string;
}

interface TableConfig {
  /** Row fixtures are typed domain rows (`Merchant`, `Payment`, ...), not index-signature maps. */
  selectOne?: unknown;
  selectMany?: unknown[] | null;
  insertResult?: unknown;
  updateResult?: unknown;
  selectError?: Err | null;
  insertError?: Err | null;
  updateError?: Err | null;
  /** Captured write payloads, for assertions. */
  inserted?: Record<string, unknown>[];
  updated?: Record<string, unknown>[];
}

function builder(
  cfg: TableConfig,
  op: "select" | "insert" | "update",
  payload?: Record<string, unknown>,
): Record<string, unknown> {
  const resolve = () => {
    if (op === "insert") {
      if (payload) (cfg.inserted ??= []).push(payload);
      return { data: cfg.insertResult ?? null, error: cfg.insertError ?? null };
    }
    if (op === "update") {
      if (payload) (cfg.updated ??= []).push(payload);
      return { data: cfg.updateResult ?? null, error: cfg.updateError ?? null };
    }
    const data = cfg.selectMany ?? cfg.selectOne ?? null;
    return { data, error: cfg.selectError ?? null };
  };

  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "is",
    "in",
    "or",
    "lt",
    "lte",
    "gt",
    "gte",
    "order",
    "limit",
    "not",
    "contains",
    "filter",
    "match",
    "neq",
  ]) {
    q[m] = () => q;
  }
  q.insert = (p: Record<string, unknown>) => builder(cfg, "insert", p);
  q.update = (p: Record<string, unknown>) => builder(cfg, "update", p);
  q.maybeSingle = () => Promise.resolve(resolve());
  q.single = () => Promise.resolve(resolve());
  q.then = (onF: (v: unknown) => unknown, onR?: (r: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onF, onR);
  return q;
}

const tables: Record<string, TableConfig> = {};

function configure(next: Record<string, TableConfig>): void {
  for (const key of Object.keys(tables)) delete tables[key];
  Object.assign(tables, next);
  fromMock.mockImplementation((table: string) => builder((tables[table] ??= {}), "select"));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISO = "2026-10-13T10:00:00.000Z";

const MERCHANT: Merchant = {
  id: "mer_1",
  name: "Acme",
  status: "active",
  kyb_status: "approved",
  payout_account: null,
  fee_rate_bps: 500,
  risk_tier: "low",
  webhook_secret_hash: null,
  created_at: ISO,
};

const WALLET: Wallet = {
  id: "wal_1",
  provider: "bkash",
  msisdn: "01711111111",
  holder_name: "Acme Collections",
  device_id: null,
  sim_slot: null,
  status: "active",
  daily_limit: 100000000,
  monthly_limit: null,
  today_total: 0,
  concurrency_cap: 5,
  last_assigned_at: null,
  created_at: ISO,
};

const FIXED_PLAN: PricingPlan = {
  id: "plan_1",
  merchant_id: "mer_1",
  name: "Standard",
  amount: 100000, // Tk 1000.00
  currency: "BDT",
  external_sku: null,
  version: 1,
  status: "active",
  open_amount: false,
  min_amount: null,
  max_amount: null,
  created_at: ISO,
};

function paymentRow(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay_1",
    merchant_id: "mer_1",
    plan_id: "plan_1",
    plan_snapshot: { id: "plan_1", name: "Standard", amount: 100000, version: 1 },
    order_id: "order_1",
    provider: "bkash",
    wallet_id: "wal_1",
    offered_wallet_ids: ["wal_1"],
    amount: 100000,
    fee_amount: 5000,
    net_amount: 95000,
    reference: "ABCDEFGH",
    status: "awaiting_payment",
    review_reason: null,
    matched_by: null,
    submitted_trx_id: null,
    idempotency_key: "idem-1",
    callback_url: null,
    metadata: null,
    expires_at: "2026-10-13T10:30:00.000Z",
    paid_at: null,
    created_at: ISO,
    ...overrides,
  };
}

/** Auth + a live wallet, the common precondition for merchant-keyed routes. */
function authTables(extra: Record<string, TableConfig> = {}): Record<string, TableConfig> {
  return {
    api_keys: { selectOne: { id: "key_1", merchant_id: "mer_1" } },
    merchants: { selectOne: MERCHANT },
    ...extra,
  };
}

function merchantRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer sk_test_${"a".repeat(64)}`);
  return new Request(`https://paygate.test${path}`, { ...init, headers });
}

beforeEach(() => {
  fromMock.mockReset();
  assignWalletMock.mockReset();
  configure({});
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

describe("plan versioning", () => {
  it("createPlan writes a fixed-amount plan at version 1 / active", async () => {
    configure({
      pricing_plans: { insertResult: { ...FIXED_PLAN } },
    });

    const plan = await createPlan("mer_1", { name: "Standard", amount: 100000 });
    expect(plan.version).toBe(1);
    const written = tables.pricing_plans.inserted?.[0];
    expect(written).toMatchObject({
      merchant_id: "mer_1",
      name: "Standard",
      amount: 100000,
      currency: "BDT",
      version: 1,
      status: "active",
      open_amount: false,
    });
  });

  it("rejects a fixed plan with no amount and an open plan with min > max", async () => {
    configure({ pricing_plans: {} });
    await expect(createPlan("mer_1", { name: "x", open_amount: false })).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
    await expect(
      createPlan("mer_1", { name: "x", open_amount: true, min_amount: 500, max_amount: 100 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("editing a plan inserts version 2 and archives version 1", async () => {
    configure({
      pricing_plans: {
        selectOne: { ...FIXED_PLAN },
        insertResult: { ...FIXED_PLAN, id: "plan_2", version: 2, amount: 200000 },
        updateResult: null,
      },
    });

    const updated = await updatePlan("mer_1", "plan_1", { amount: 200000 });
    expect(updated.id).toBe("plan_2");
    expect(updated.version).toBe(2);
    expect(tables.pricing_plans.inserted?.[0]).toMatchObject({ version: 2, amount: 200000 });
    expect(tables.pricing_plans.updated?.[0]).toEqual({ status: "archived" });
  });
});

// ---------------------------------------------------------------------------
// Payment creation (contract + money + wallet assignment)
// ---------------------------------------------------------------------------

describe("POST /v1/payments", () => {
  it("creates an awaiting_payment with a live wallet, fee/net and a pay_url", async () => {
    assignWalletMock.mockResolvedValue(WALLET);
    configure(
      authTables({
        payments: { selectOne: null, insertResult: paymentRow(), inserted: [] },
        pricing_plans: { selectOne: { ...FIXED_PLAN } },
        wallets: { selectOne: WALLET },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "idem-1", "content-type": "application/json" },
        body: JSON.stringify({
          plan_id: "plan_1",
          order_id: "order_1",
          provider: "bkash",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "pay_1",
      status: "awaiting_payment",
      amount: 100000,
      fee_amount: 5000,
      net_amount: 95000,
      provider: "bkash",
      order_id: "order_1",
      wallet: { provider: "bkash", number: "01711111111" },
    });
    expect(body.pay_url).toBe("https://paygate.test/pay/pay_1");

    // The row actually written: wallet pinned, reference allocated, TTL ~30m.
    const written = tables.payments.inserted?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      merchant_id: "mer_1",
      provider: "bkash",
      wallet_id: "wal_1",
      offered_wallet_ids: ["wal_1"],
      amount: 100000,
      fee_amount: 5000,
      net_amount: 95000,
      status: "awaiting_payment",
      idempotency_key: "idem-1",
    });
    expect(String(written.reference)).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    const ttlMs = new Date(String(written.expires_at)).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60_000 + 5_000);
  });

  it("persists optional success_url/cancel_url redirect targets (v3.1)", async () => {
    assignWalletMock.mockResolvedValue(WALLET);
    configure(
      authTables({
        payments: { selectOne: null, insertResult: paymentRow(), inserted: [] },
        pricing_plans: { selectOne: { ...FIXED_PLAN } },
        wallets: { selectOne: WALLET },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "idem-1", "content-type": "application/json" },
        body: JSON.stringify({
          plan_id: "plan_1",
          order_id: "order_1",
          provider: "bkash",
          success_url: "https://shop.test/ok",
          cancel_url: "https://shop.test/cancel",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const written = tables.payments.inserted?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      success_url: "https://shop.test/ok",
      cancel_url: "https://shop.test/cancel",
    });
  });

  it("400s when success_url/cancel_url are not valid URLs", async () => {
    configure(authTables());
    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "k", "content-type": "application/json" },
        body: JSON.stringify({
          plan_id: "plan_1",
          order_id: "o",
          provider: "bkash",
          success_url: "not-a-url",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("replays an existing payment for a repeated Idempotency-Key without assigning a wallet", async () => {
    const existing = paymentRow({ idempotency_key: "idem-dup" });
    configure(
      authTables({
        payments: { selectOne: existing },
        wallets: { selectOne: WALLET },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "idem-dup", "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "plan_1", order_id: "order_1", provider: "bkash" }),
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("pay_1");
    expect(assignWalletMock).not.toHaveBeenCalled();
  });

  it("400s when the Idempotency-Key header is missing", async () => {
    configure(authTables());
    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "plan_1", order_id: "o", provider: "bkash" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("400s on an unknown provider", async () => {
    configure(authTables());
    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "plan_1", order_id: "o", provider: "paypal" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("401s without a merchant API key and never touches the DB", async () => {
    configure(authTables());
    const res = await createPaymentRoute(
      new Request("https://paygate.test/v1/payments", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("503s when no wallet is available for the provider", async () => {
    assignWalletMock.mockResolvedValue(null);
    configure(
      authTables({
        payments: { selectOne: null },
        pricing_plans: { selectOne: { ...FIXED_PLAN } },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "plan_1", order_id: "o", provider: "bkash" }),
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("no_wallet_available");
  });

  it("422s for an open-amount plan (no amount to charge)", async () => {
    assignWalletMock.mockResolvedValue(WALLET);
    configure(
      authTables({
        payments: { selectOne: null },
        pricing_plans: {
          selectOne: { ...FIXED_PLAN, amount: null, open_amount: true, min_amount: 1000, max_amount: 5000 },
        },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "plan_1", order_id: "o", provider: "bkash" }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("unprocessable");
  });

  it("404s when the plan does not exist for the merchant", async () => {
    assignWalletMock.mockResolvedValue(WALLET);
    configure(
      authTables({
        payments: { selectOne: null },
        pricing_plans: { selectOne: null },
      }),
    );

    const res = await createPaymentRoute(
      merchantRequest("/v1/payments", {
        method: "POST",
        headers: { "idempotency-key": "k", "content-type": "application/json" },
        body: JSON.stringify({ plan_id: "missing", order_id: "o", provider: "bkash" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/payments", () => {
  it("lists payments and paginates with next_cursor", async () => {
    configure(
      authTables({
        payments: {
          selectMany: [
            paymentRow({ id: "pay_3" }),
            paymentRow({ id: "pay_2" }),
            paymentRow({ id: "pay_1" }),
          ],
        },
      }),
    );

    const res = await listPaymentsRoute(merchantRequest("/v1/payments?limit=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).toBeTypeOf("string");
  });

  it("lists payments filtered by the confirming status (v3.1)", async () => {
    configure(
      authTables({
        payments: {
          selectMany: [{ ...paymentRow(), id: "pay_9", status: "confirming" }],
        },
      }),
    );

    const res = await listPaymentsRoute(merchantRequest("/v1/payments?status=confirming"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("confirming");
  });
});

// ---------------------------------------------------------------------------
// Single payment + cancel
// ---------------------------------------------------------------------------

describe("cancel + reads", () => {
  it("GET /v1/payments/:id returns the payment", async () => {
    configure(authTables({ payments: { selectOne: paymentRow() } }));
    const res = await getPaymentRoute(merchantRequest("/v1/payments/pay_1"), {
      params: Promise.resolve({ id: "pay_1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("pay_1");
  });

  it("cancelPayment transitions an open payment to cancelled", async () => {
    configure({
      payments: {
        selectOne: paymentRow({ status: "awaiting_payment" }),
        updateResult: paymentRow({ status: "cancelled" }),
        updated: [],
      },
    });

    const cancelled = await cancelPayment("mer_1", "pay_1");
    expect(cancelled.status).toBe("cancelled");
    expect(tables.payments.updated?.[0]).toEqual({ status: "cancelled" });
  });

  it("cancelPayment cancels a confirming payment (v3.1)", async () => {
    configure({
      payments: {
        selectOne: { ...paymentRow(), status: "confirming" },
        updateResult: paymentRow({ status: "cancelled" }),
        updated: [],
      },
    });

    const cancelled = await cancelPayment("mer_1", "pay_1");
    expect(cancelled.status).toBe("cancelled");
    expect(tables.payments.updated?.[0]).toEqual({ status: "cancelled" });
  });

  it("cancelPayment 409s on a terminal payment and writes nothing", async () => {
    configure({ payments: { selectOne: paymentRow({ status: "paid" }) } });
    await expect(cancelPayment("mer_1", "pay_1")).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
    expect(tables.payments.updated).toBeUndefined();
  });

  it("POST /v1/payments/:id/cancel returns 200 and does not fail when the webhook dispatcher is absent", async () => {
    configure(
      authTables({
        payments: {
          selectOne: paymentRow({ status: "awaiting_payment" }),
          updateResult: paymentRow({ status: "cancelled" }),
        },
      }),
    );

    const res = await cancelPaymentRoute(merchantRequest("/v1/payments/pay_1/cancel", { method: "POST" }), {
      params: Promise.resolve({ id: "pay_1" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Public pay page
// ---------------------------------------------------------------------------

describe("public pay page", () => {
  it("exposes only customer-facing fields and sets trxid_required by provider mode", async () => {
    configure({
      payments: {
        selectOne: { ...paymentRow(), wallets: { provider: "bkash", msisdn: "01711111111", holder_name: "Acme" } },
      },
    });

    const view = await getPayPage("pay_1");
    expect(view).toMatchObject({
      id: "pay_1",
      status: "awaiting_payment",
      amount: 100000,
      provider: "bkash",
      reference: "ABCDEFGH",
      wallet: { provider: "bkash", number: "01711111111" },
      trxid_required: false,
    });
    // No merchant-secret leakage.
    expect(view).not.toHaveProperty("fee_amount");
    expect(view).not.toHaveProperty("net_amount");
    expect(view).not.toHaveProperty("metadata");
    expect(view).not.toHaveProperty("callback_url");
  });

  it("GET /v1/pay/:id is unauthenticated and 404s an unknown payment", async () => {
    configure({ payments: { selectOne: null } });
    const res = await payPageRoute(new Request("https://paygate.test/v1/pay/pay_x"), {
      params: Promise.resolve({ id: "pay_x" }),
    });
    expect(res.status).toBe(404);
  });

  it("submitPaymentTrx persists a TrxID while the payment is open", async () => {
    configure({
      payments: {
        selectOne: { id: "pay_1", status: "awaiting_payment" },
        updateResult: { status: "awaiting_payment" },
        updated: [],
      },
    });

    const result = await submitPaymentTrx("pay_1", "8N7A1B2C3D");
    expect(result).toEqual({ ok: true, status: "awaiting_payment" });
    expect(tables.payments.updated?.[0]).toEqual({ submitted_trx_id: "8N7A1B2C3D" });
  });

  it("submitPaymentTrx 409s once the payment is terminal", async () => {
    configure({ payments: { selectOne: { id: "pay_1", status: "paid" } } });
    await expect(submitPaymentTrx("pay_1", "8N7A1B2C3D")).rejects.toMatchObject({ status: 409 });
  });

  it("POST /v1/pay/:id/submit-trx 200s for an open payment", async () => {
    configure({
      payments: {
        selectOne: { id: "pay_1", status: "awaiting_payment" },
        updateResult: { status: "awaiting_payment" },
      },
    });
    const res = await submitTrxRoute(
      new Request("https://paygate.test/v1/pay/pay_1/submit-trx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trx_id: "8N7A1B2C3D" }),
      }),
      { params: Promise.resolve({ id: "pay_1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "awaiting_payment" });
  });
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

describe("POST /v1/onboarding/apply", () => {
  const payload = {
    name: "New Shop",
    email: "owner@newshop.test",
    phone: "01700000000",
    business_type: "retail",
    // `as const` keeps the literals narrow so `payout_account` matches the
    // onboarding schema's `type`/`provider` enums instead of widening to `string`.
    payout_account: { type: "mfs", provider: "bkash", account_no: "01700000000" } as const,
  };

  it("creates a pending merchant and records the applicant in the audit log", async () => {
    configure({
      merchants: { insertResult: { ...MERCHANT, id: "mer_new", status: "pending" }, inserted: [] },
      audit_log: { insertResult: { id: "aud_1" }, inserted: [] },
    });

    const result = await applyForMerchant(payload, { ip: "203.0.113.9" });
    expect(result.merchant_id).toMatch(/^mer_/);
    expect(result.status).toBe("pending");

    const merchant = tables.merchants.inserted?.[0] as Record<string, unknown>;
    expect(merchant).toMatchObject({ name: "New Shop", status: "pending", kyb_status: "under_review" });

    const audit = tables.audit_log.inserted?.[0] as Record<string, unknown>;
    expect(audit).toMatchObject({ action: "onboarding.applied", entity_id: result.merchant_id });
    expect((audit.after as Record<string, unknown>).email).toBe("owner@newshop.test");
  });

  it("201s through the route and 400s on a malformed payload", async () => {
    configure({
      merchants: { insertResult: { ...MERCHANT, status: "pending" } },
      audit_log: { insertResult: { id: "aud_1" } },
    });

    const ok = await applyRoute(
      new Request("https://paygate.test/v1/onboarding/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(ok.status).toBe(201);
    expect((await ok.json()).status).toBe("pending");

    const bad = await applyRoute(
      new Request("https://paygate.test/v1/onboarding/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", email: "not-an-email" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});
