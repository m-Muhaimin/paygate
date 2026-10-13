/**
 * Unit tests for the payout money rules (mocked `db()`).
 * Run: `npx vitest run src/lib/__tests__/payouts.test.ts`
 *
 * Covers the SPEC §0 invariants that protect the money chain:
 *   - Tk 1,000 minimum (99999 paisa rejected, 100000 accepted)
 *   - available-balance ceiling that subtracts pending payouts (F1)
 *   - atomic two-person approval via the `approve_payout` RPC (F2)
 *   - rejection stamps `rejected_by`/`rejected_at` (F3)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: () => ({ from: fromMock, rpc: rpcMock }),
  isPrivileged: () => true,
  dbAsUser: vi.fn(),
}));

import { ApiError } from "@/lib/api/errors";
import type { Payout } from "@/lib/db/types";
import { approvePayout, pendingPayoutTotal, rejectPayout, requestPayout, spendableBalance } from "@/lib/payouts/service";
import { MIN_PAYOUT_PAISA, PENDING_PAYOUT_STATUSES } from "@/lib/payouts/constants";
import { validatePayoutAmount } from "@/lib/payouts/validation";

interface SupabaseResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/** Chainable PostgREST-builder stand-in (mirrors plumbing.test.ts). */
function query(result: SupabaseResult, write?: SupabaseResult): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "in", "order", "limit", "not", "contains", "lte", "gte", "ilike", "lt"]) {
    q[method] = () => q;
  }
  q.maybeSingle = () => Promise.resolve(result);
  q.single = () => Promise.resolve(result);
  q.update = () => query(write ?? { data: null, error: null });
  q.insert = () => query(write ?? { data: null, error: null });
  q.then = (
    onFulfilled: (value: SupabaseResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return q;
}

const ok = (data: unknown): SupabaseResult => ({ data, error: null });
const fail = (message: string): SupabaseResult => ({ data: null, error: { message } });

/** A pending-payout rollup query (`from().select().eq().in()` — no terminal). */
const pending = (rows: { amount: number }[]): Record<string, unknown> => query(ok(rows));

function payoutRow(overrides: Partial<Payout> = {}): Payout {
  return {
    id: "po_1",
    merchant_id: "mer_1",
    amount: 250_000,
    rail: "bank",
    destination: { account_no: "123", holder: "Acme" },
    status: "requested",
    requested_by: "user:requester",
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    created_at: "2026-10-13T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("payouts/constants", () => {
  it("pins the minimum to Tk 1,000 and reserves ONLY requested payouts (A1)", () => {
    expect(MIN_PAYOUT_PAISA).toBe(100_000);
    // approved funds are already debited from the ledger by approve_payout, so
    // counting them here would double-subtract from available balance.
    expect(PENDING_PAYOUT_STATUSES).toEqual(["requested"]);
  });
});

describe("payouts/validation.validatePayoutAmount", () => {
  it("rejects 99999 paisa (just under the minimum)", () => {
    let caught: unknown;
    try {
      validatePayoutAmount(99_999, 10_000_000);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 400, code: "bad_request" });
  });

  it("accepts exactly 100000 paisa", () => {
    expect(() => validatePayoutAmount(100_000, 10_000_000)).not.toThrow();
  });

  it("rejects a non-integer or non-positive amount", () => {
    expect(() => validatePayoutAmount(100_000.5, 10_000_000)).toThrow();
    expect(() => validatePayoutAmount(0, 10_000_000)).toThrow();
    expect(() => validatePayoutAmount(-1, 10_000_000)).toThrow();
  });

  it("rejects an amount above the available balance", () => {
    expect(() => validatePayoutAmount(200_000, 100_000)).toThrow();
  });
});

describe("payouts/service.requestPayout", () => {
  it("rejects below the minimum without inserting a payout", async () => {
    rpcMock.mockResolvedValue(ok(10_000_000)); // plenty of ledger balance
    fromMock.mockReturnValueOnce(pending([]));

    await expect(
      requestPayout({
        merchantId: "mer_1",
        actor: "api_key:sk_live_",
        input: { amount: 99_999, rail: "mfs" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledTimes(1); // only the pending-payout rollup
  });

  it("rejects when the amount exceeds the ledger balance", async () => {
    rpcMock.mockResolvedValue(ok(150_000));
    fromMock.mockReturnValueOnce(pending([]));

    await expect(
      requestPayout({
        merchantId: "mer_1",
        actor: "api_key:sk_live_",
        input: { amount: 200_000, rail: "bank" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("rejects when a prior requested payout already reserves the balance (F1)", async () => {
    rpcMock.mockResolvedValue(ok(300_000)); // ledger says 300,000
    fromMock.mockReturnValueOnce(pending([{ amount: 250_000 }])); // 250,000 already spoken for

    await expect(
      requestPayout({
        merchantId: "mer_1",
        actor: "api_key:sk_live_",
        input: { amount: 100_000, rail: "bank" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("inserts a requested payout and audits it when valid", async () => {
    const created = payoutRow({ amount: 250_000 });
    const inserted: unknown[] = [];
    rpcMock.mockResolvedValue(ok(1_000_000));
    fromMock
      .mockReturnValueOnce(pending([])) // pending-payout rollup
      .mockImplementationOnce(() => {
        const q = query(ok(created));
        q.insert = (row: unknown) => {
          inserted.push(row);
          return query(ok(created));
        };
        return q;
      })
      .mockReturnValueOnce(query(ok(null), ok({ id: "aud_1" }))); // audit insert -> single

    const payout = await requestPayout({
      merchantId: "mer_1",
      actor: "api_key:sk_live_",
      input: { amount: 250_000, rail: "bank", destination: { account_no: "1", holder: "A" } },
    });

    expect(payout.id).toBe("po_1");
    expect(payout.status).toBe("requested");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      merchant_id: "mer_1",
      amount: 250_000,
      rail: "bank",
      status: "requested",
      requested_by: "api_key:sk_live_",
      approved_by: null,
    });
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});

describe("payouts/service reservation semantics (A1: approved is already debited)", () => {
  it("reserves requested payouts only and never double-subtracts approved funds", async () => {
    // Ledger is 500,000 paisa AFTER an approved payout's debit was posted. The
    // approved payout's money is already out of the ledger; only the 150,000
    // requested payout still reserves balance.
    rpcMock.mockResolvedValue(ok(500_000));

    const statusFilters: unknown[][] = [];
    fromMock.mockImplementation(() => {
      const q = query(ok([{ amount: 150_000 }]));
      const inFn = q.in as (column: string, values: unknown) => unknown;
      q.in = (column: unknown, values: unknown) => {
        statusFilters.push([column, values]);
        return inFn(column as string, values);
      };
      return q;
    });

    const total = await pendingPayoutTotal("mer_1");
    const spendable = await spendableBalance("mer_1");

    // Every pending rollup queries status IN ["requested"] — never "approved".
    expect(statusFilters.length).toBeGreaterThanOrEqual(1);
    for (const filter of statusFilters) {
      expect(filter).toEqual(["status", ["requested"]]);
    }
    expect(total).toBe(150_000);
    expect(spendable).toBe(350_000); // 500,000 ledger − 150,000 requested
  });
});

describe("payouts/service.approvePayout (atomic RPC, F2)", () => {
  const cases: { code: string; status: number; errorCode: string }[] = [
    { code: "PAYOUT_NOT_FOUND", status: 404, errorCode: "not_found" },
    { code: "PAYOUT_NOT_REQUESTED", status: 409, errorCode: "conflict" },
    { code: "PAYOUT_SELF_APPROVAL", status: 403, errorCode: "forbidden" },
    { code: "PAYOUT_INSUFFICIENT_BALANCE", status: 400, errorCode: "bad_request" },
    { code: "SOMETHING_ELSE", status: 502, errorCode: "provider_error" },
  ];

  for (const c of cases) {
    it(`maps RPC ${c.code} -> HTTP ${c.status}`, async () => {
      fromMock.mockReturnValueOnce(query(ok(payoutRow()))); // loadPayout snapshot
      rpcMock.mockResolvedValue(fail(`approve_payout: ${c.code}`));

      await expect(
        approvePayout({ payoutId: "po_1", actor: "user:checker" }),
      ).rejects.toMatchObject({ status: c.status, code: c.errorCode });
    });
  }

  it("calls the approve_payout RPC with the actor and returns its row", async () => {
    const before = payoutRow({ requested_by: "user:requester" });
    const after = payoutRow({
      status: "approved",
      approved_by: "user:checker",
      approved_at: "2026-10-13T01:00:00.000Z",
    });
    fromMock
      .mockReturnValueOnce(query(ok(before))) // loadPayout
      .mockReturnValueOnce(query(ok(null), ok({ id: "aud_2" }))); // audit insert
    rpcMock.mockResolvedValue(ok([after])); // `returns setof payouts`

    const approved = await approvePayout({
      payoutId: "po_1",
      actor: "user:checker",
      note: "verified bank slip",
    });

    expect(rpcMock).toHaveBeenCalledWith("approve_payout", {
      p_payout_id: "po_1",
      p_actor: "user:checker",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBe("user:checker");
    expect(fromMock).toHaveBeenCalledTimes(2); // load + audit
  });

  it("surfaces a 403 for self-approval raised by the RPC", async () => {
    fromMock.mockReturnValueOnce(query(ok(payoutRow({ requested_by: "user:same" }))));
    rpcMock.mockResolvedValue(fail("approve_payout: PAYOUT_SELF_APPROVAL"));

    await expect(
      approvePayout({ payoutId: "po_1", actor: "user:same" }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("payouts/service.rejectPayout", () => {
  it("is idempotent when the payout is already rejected", async () => {
    const rejected = payoutRow({ status: "rejected" });
    fromMock.mockReturnValueOnce(query(ok(rejected)));

    const result = await rejectPayout({ payoutId: "po_1", actor: "user:checker" });
    expect(result.status).toBe("rejected");
    // Only the load query ran; no update/audit.
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("stamps rejected_by/rejected_at and audits the reason (F3)", async () => {
    const before = payoutRow();
    const rejectedRow = payoutRow({ status: "rejected" });
    let updatePayload: unknown;
    fromMock
      .mockReturnValueOnce(query(ok(before))) // load
      .mockImplementationOnce(() => {
        const q = query(ok(rejectedRow));
        q.update = (payload: unknown) => {
          updatePayload = payload;
          return query(ok(rejectedRow));
        };
        return q;
      })
      .mockReturnValueOnce(query(ok(null), ok({ id: "aud_3" }))); // audit

    const result = await rejectPayout({
      payoutId: "po_1",
      actor: "user:checker",
      reason: "details mismatch",
    });
    expect(result.status).toBe("rejected");
    expect(updatePayload).toMatchObject({
      status: "rejected",
      rejected_by: "user:checker",
    });
    expect(updatePayload).toHaveProperty("rejected_at");
    expect(updatePayload).not.toHaveProperty("approved_by");
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});
