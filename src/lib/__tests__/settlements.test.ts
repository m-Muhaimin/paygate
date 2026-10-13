/**
 * Unit tests for settlement reads, the balance summary, the CSV serializer and
 * the admin review case codec (mocked `db()`).
 * Run: `npx vitest run src/lib/__tests__/settlements.test.ts`
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

import type { Settlement } from "@/lib/db/types";
import { requireAdmin } from "@/lib/settlements/admin";
import { escapeCsvField, settlementsToCsv, SETTLEMENT_CSV_COLUMNS } from "@/lib/settlements/csv";
import {
  decodeIncomingCaseId,
  decodePaymentCaseId,
  encodeIncomingCaseId,
  encodePaymentCaseId,
} from "@/lib/settlements/review";
import {
  exportSettlementsCsv,
  getBalanceSummary,
  listSettlements,
} from "@/lib/settlements/service";

interface SupabaseResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

function query(result: SupabaseResult, write?: SupabaseResult): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "not", "contains", "lte", "gte", "ilike", "lt"]) {
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

function settlementRow(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: "set_1",
    merchant_id: "mer_1",
    period_start: "2026-09-01T00:00:00.000Z",
    period_end: "2026-09-30T23:59:59.000Z",
    gross_amount: 1_000_000,
    fee_amount: 20_000,
    net_amount: 980_000,
    status: "paid",
    created_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("settlements/csv", () => {
  it("exposes the settlement columns in a stable order", () => {
    expect(SETTLEMENT_CSV_COLUMNS[0]).toBe("id");
    expect(SETTLEMENT_CSV_COLUMNS).toContain("net_amount");
  });

  it("escapes commas, quotes and newlines per RFC 4180", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("serializes rows with a header and CRLF terminators", () => {
    const csv = settlementsToCsv([settlementRow(), settlementRow({ id: "set_2" })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(SETTLEMENT_CSV_COLUMNS.join(","));
    expect(lines[1]).toContain("set_1");
    expect(lines[2]).toContain("set_2");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("emits only the header for an empty result set", () => {
    const csv = settlementsToCsv([]);
    expect(csv).toBe(`${SETTLEMENT_CSV_COLUMNS.join(",")}\r\n`);
  });
});

describe("settlements/service.listSettlements", () => {
  it("returns the merchant's settlements", async () => {
    fromMock.mockReturnValueOnce(query(ok([settlementRow()])));
    const rows = await listSettlements("mer_1", { limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("set_1");
  });

  it("returns an empty array when the query yields nothing", async () => {
    fromMock.mockReturnValueOnce(query(ok(null)));
    expect(await listSettlements("mer_1")).toEqual([]);
  });
});

describe("settlements/service.exportSettlementsCsv", () => {
  it("renders the list as a CSV document", async () => {
    fromMock.mockReturnValueOnce(query(ok([settlementRow()])));
    const csv = await exportSettlementsCsv("mer_1");
    expect(csv.startsWith("id,merchant_id")).toBe(true);
    expect(csv).toContain("set_1");
  });
});

describe("settlements/service.getBalanceSummary", () => {
  it("derives available from the RPC minus requested payouts, lifetime totals from paid payments", async () => {
    rpcMock.mockResolvedValue(ok(500_000));
    fromMock
      .mockReturnValueOnce(
        query(
          ok([
            { amount: 1_000, fee_amount: 100, net_amount: 900 },
            { amount: 2_000, fee_amount: 200, net_amount: 1_800 },
          ]),
        ),
      )
      // Payout rollup (status IN ["requested"]): a 300-paisa requested payout.
      .mockReturnValueOnce(query(ok([{ amount: 300 }])));

    const summary = await getBalanceSummary("mer_1");
    expect(summary).toEqual({
      available: 499_700,
      pending_payouts: 300,
      lifetime_gross: 3_000,
      lifetime_fees: 300,
      lifetime_net: 2_700,
      currency: "BDT",
    });
  });

  it("treats approved payouts as already debited: only requested reduces available (A1)", async () => {
    // Ledger is 200,000 paisa AFTER a 300,000 approved payout was debited. That
    // approved money is gone from the ledger; counting it as pending again
    // would double-subtract (old: 200,000 − 450,000 = −250,000).
    rpcMock.mockResolvedValue(ok(200_000));
    fromMock
      .mockReturnValueOnce(query(ok([]))) // no paid payments
      .mockReturnValueOnce(query(ok([{ amount: 150_000 }]))); // one requested payout

    const summary = await getBalanceSummary("mer_1");
    expect(summary.pending_payouts).toBe(150_000);
    expect(summary.available).toBe(50_000); // 200,000 − 150,000, not −250,000
  });

  it("treats missing ledger/payment data as zero", async () => {
    rpcMock.mockResolvedValue(ok(0));
    fromMock
      .mockReturnValueOnce(query(ok(null)))
      .mockReturnValueOnce(query(ok(null)));

    const summary = await getBalanceSummary("mer_1");
    expect(summary.available).toBe(0);
    expect(summary.lifetime_gross).toBe(0);
    expect(summary.pending_payouts).toBe(0);
  });
});

describe("settlements/review codec", () => {
  it("round-trips an incoming-txn case id", () => {
    const key = { provider: "bkash" as const, trxId: "TRX123", walletId: "wal_9" };
    const id = encodeIncomingCaseId(key);
    expect(id.startsWith("itx:")).toBe(true);
    expect(decodeIncomingCaseId(id)).toEqual(key);
  });

  it("returns null for malformed incoming case ids", () => {
    expect(decodeIncomingCaseId("pay:abc")).toBeNull();
    expect(decodeIncomingCaseId("itx:not-base64!!")).toBeNull();
    expect(decodeIncomingCaseId("itx:" + Buffer.from('["only"]').toString("base64url"))).toBeNull();
  });

  it("round-trips a payment-backed case id", () => {
    const id = encodePaymentCaseId("pay_123");
    expect(id).toBe("pay:pay_123");
    expect(decodePaymentCaseId(id)).toBe("pay_123");
    expect(decodePaymentCaseId("itx:zzz")).toBeNull();
  });
});

describe("settlements/admin.requireAdmin", () => {
  it("fails closed without an admin identity", async () => {
    await expect(
      requireAdmin(new Request("https://paygate.test/v1/admin/wallets")),
    ).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown merchant user", async () => {
    fromMock.mockReturnValueOnce(query(ok(null)));
    await expect(
      requireAdmin(
        new Request("https://paygate.test/v1/admin/wallets", {
          headers: { "x-merchant-user-id": "mru_missing" },
        }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("admits an owner", async () => {
    fromMock.mockReturnValueOnce(query(ok({ id: "mru_1", role: "owner" })));
    await expect(
      requireAdmin(
        new Request("https://paygate.test/v1/admin/wallets", {
          headers: { "x-merchant-user-id": "mru_1" },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
