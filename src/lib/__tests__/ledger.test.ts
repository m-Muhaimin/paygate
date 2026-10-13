import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: vi.fn() }));

import { db } from "@/lib/db/client";
import type { Payment } from "@/lib/db/types";
import { postPaymentPaid } from "../ledger/post";

interface LedgerRow {
  id: string;
  merchant_id?: string;
  payment_id?: string;
  entry_group: string;
  account: string;
  direction: string;
  amount: number;
}

interface UpsertCall {
  rows: LedgerRow[];
  options: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;
}

function clientReturning(rows: LedgerRow[], calls: UpsertCall[] = []): ReturnType<typeof db> {
  return {
    from: () => ({
      upsert: (v: LedgerRow[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        calls.push({ rows: v, options });
        // Simulate the `(payment_id, account)` unique constraint: a repeat leg
        // for the same payment+account is an ignored duplicate, not a new row.
        for (const row of v) {
          const duplicate = rows.some(
            (r) => r.payment_id === row.payment_id && r.account === row.account,
          );
          if (!duplicate) rows.push(row);
        }
        return { error: null };
      },
    }),
  } as unknown as ReturnType<typeof db>;
}

function clientFailing(code: string): ReturnType<typeof db> {
  return {
    from: () => ({ upsert: () => ({ error: { code } }) }),
  } as unknown as ReturnType<typeof db>;
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: "pay_1",
    merchant_id: "mer_1",
    amount: 120000,
    fee_amount: 6000,
    net_amount: 114000,
    ...overrides,
  } as Payment;
}

describe("ledger posting", () => {
  it("posts a balanced double entry: payin debit = fee + merchant_payable credits", async () => {
    const inserted: LedgerRow[] = [];
    vi.mocked(db).mockReturnValue(clientReturning(inserted));

    await postPaymentPaid(payment({}));

    expect(inserted).toHaveLength(3);
    const payin = inserted.find((r) => r.account === "payin");
    const fee = inserted.find((r) => r.account === "fee");
    const payable = inserted.find((r) => r.account === "merchant_payable");

    expect(payin).toMatchObject({ direction: "debit", amount: 120000 });
    expect(fee).toMatchObject({ direction: "credit", amount: 6000 });
    expect(payable).toMatchObject({ direction: "credit", amount: 114000 });

    // Balanced: debits === credits across the group.
    const debits = inserted.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);
    const credits = inserted.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);

    // One shared entry group; unique ids.
    expect(new Set(inserted.map((r) => r.entry_group)).size).toBe(1);
    expect(new Set(inserted.map((r) => r.id)).size).toBe(3);
  });

  it("omits a zero-value fee leg (0-bps plan) while staying balanced", async () => {
    const inserted: LedgerRow[] = [];
    vi.mocked(db).mockReturnValue(clientReturning(inserted));

    await postPaymentPaid(payment({ amount: 50000, fee_amount: 0, net_amount: 50000 }));

    expect(inserted).toHaveLength(2);
    expect(inserted.find((r) => r.account === "fee")).toBeUndefined();
    const debits = inserted.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);
    const credits = inserted.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
    expect(debits).toBe(credits);
    expect(new Set(inserted.map((r) => r.entry_group)).size).toBe(1);
  });

  it("posts nothing for a zero-amount payment", async () => {
    const inserted: LedgerRow[] = [];
    vi.mocked(db).mockReturnValue(clientReturning(inserted));

    await postPaymentPaid(payment({ amount: 0, fee_amount: 0, net_amount: 0 }));

    expect(inserted).toHaveLength(0);
  });

  it("throws an internal error when the upsert fails", async () => {
    vi.mocked(db).mockReturnValue(clientFailing("23505"));

    await expect(
      postPaymentPaid(payment({ id: "pay_1", amount: 100, fee_amount: 5, net_amount: 95 })),
    ).rejects.toThrow();
  });

  it("is idempotent per payment: a second post for the same payment inserts no rows", async () => {
    const inserted: LedgerRow[] = [];
    const calls: UpsertCall[] = [];
    vi.mocked(db).mockReturnValue(clientReturning(inserted, calls));
    const p = payment({});

    await postPaymentPaid(p);
    await postPaymentPaid(p);

    // Second call is deduped by the (payment_id, account) unique constraint.
    expect(inserted).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[0].options).toEqual({ onConflict: "payment_id,account", ignoreDuplicates: true });
    expect(calls[1].options).toEqual({ onConflict: "payment_id,account", ignoreDuplicates: true });
    const dupes = inserted.filter((r) => r.account === "merchant_payable");
    expect(dupes).toHaveLength(1);
  });
});
