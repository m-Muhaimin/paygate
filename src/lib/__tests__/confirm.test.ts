import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `POST /v1/pay/:id/confirm` (SPEC v3.1 §B).
 *
 * The route is exercised end-to-end with the Supabase client, the matching engine
 * and the pay-page serializer mocked. Each request uses a distinct
 * `x-forwarded-for` so the module-level 10/min/IP limiter never trips between
 * tests. `PAY_CONFIRM_HOLD_MS` keeps the poll window tiny.
 */

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  matchResult: { status: "confirming" } as Record<string, unknown>,
  matchCalls: 0,
  payPage: { id: "pay_1", status: "confirming" } as Record<string, unknown>,
}));

vi.mock("@/lib/db/client", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        h.updates.push(patch);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    }),
  }),
}));

vi.mock("@/lib/matching/engine", () => ({
  matchPayment: async () => {
    h.matchCalls += 1;
    return h.matchResult;
  },
}));

vi.mock("@/lib/services/payments", () => ({
  getPayPage: async () => h.payPage,
}));

import { POST } from "@/app/api/v1/pay/[id]/confirm/route";

const CTX = { params: Promise.resolve({ id: "pay_1" }) };

function req(ip: string, body: unknown = { trx_id: "8N7A1B2C3D" }): Request {
  return new Request("https://paygate.test/v1/pay/pay_1/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

function baseRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pay_1",
    status: "awaiting_payment",
    reference: "ABCDEFGH",
    submitted_trx_id: null,
    matched_by: null,
    review_reason: null,
    confirm_attempts: 0,
    locked_until: null,
    ...over,
  };
}

let ip = 0;
function nextIp(): string {
  ip += 1;
  return `10.9.0.${ip}`;
}

beforeEach(() => {
  h.row = baseRow();
  h.updates = [];
  h.matchResult = { status: "confirming" };
  h.matchCalls = 0;
  h.payPage = { id: "pay_1", status: "confirming" };
  process.env.PAY_CONFIRM_HOLD_MS = "0";
  process.env.PAY_CONFIRM_POLL_MS = "5";
});

afterEach(() => {
  delete process.env.PAY_CONFIRM_HOLD_MS;
  delete process.env.PAY_CONFIRM_POLL_MS;
});

describe("POST /v1/pay/:id/confirm", () => {
  it("records the TrxID, moves to confirming and returns confirming on timeout", async () => {
    h.row = baseRow();
    h.matchResult = { status: "confirming" };
    process.env.PAY_CONFIRM_HOLD_MS = "30";

    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("confirming");
    expect(body.payment).toEqual(h.payPage);

    // Persisted the claim and the state transition before matching.
    expect(h.updates[0]).toMatchObject({
      submitted_trx_id: "8N7A1B2C3D",
      confirm_attempts: 1,
      status: "confirming",
    });
    expect(typeof h.updates[0]?.confirmed_at).toBe("string");
    // Held and polled rather than answering immediately.
    expect(h.matchCalls).toBeGreaterThan(1);
  });

  it("does not restamp confirmed_at or status on a re-confirm", async () => {
    h.row = baseRow({ status: "confirming" });
    h.matchResult = { status: "confirming" };

    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(200);
    await res.json();
    expect(h.updates[0]).not.toHaveProperty("confirmed_at");
    expect(h.updates[0]).not.toHaveProperty("status");
  });

  it("returns paid immediately when the SMS is already stored", async () => {
    h.row = baseRow();
    h.matchResult = { status: "paid", matched_by: "trxid" };

    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("paid");
    expect(body.matched_by).toBe("trxid");
    expect(h.matchCalls).toBe(1);
  });

  it("400s a malformed TrxID without recording an attempt", async () => {
    h.row = baseRow({ status: "confirming" });
    const res = await POST(req(nextIp(), { trx_id: "abc" }), CTX);
    expect(res.status).toBe(400);
    expect(h.updates).toEqual([]);
    expect(h.matchCalls).toBe(0);
  });

  it("404s an unknown payment", async () => {
    h.row = null;
    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(404);
  });

  it("429s with too_many_attempts when the payment is locked", async () => {
    h.row = baseRow({
      status: "confirming",
      locked_until: new Date(Date.now() + 600_000).toISOString(),
    });
    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_many_attempts");
    expect(h.matchCalls).toBe(0);
  });

  it("locks the payment once the 5th attempt is used", async () => {
    h.row = baseRow({ status: "confirming", confirm_attempts: 4 });
    h.matchResult = { status: "confirming" };

    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(200);
    await res.json();
    expect(h.updates[0]).toMatchObject({ confirm_attempts: 5 });
    expect(typeof h.updates[0]?.locked_until).toBe("string");
  });

  it("returns a terminal payment as-is without recording a new attempt", async () => {
    h.row = baseRow({ status: "paid", matched_by: "reference" });
    const res = await POST(req(nextIp()), CTX);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("paid");
    expect(body.matched_by).toBe("reference");
    expect(h.updates).toEqual([]);
    expect(h.matchCalls).toBe(0);
  });
});
