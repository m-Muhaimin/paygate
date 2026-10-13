import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: vi.fn() }));
vi.mock("@/lib/db/rpc", () => ({ claimIncomingTxn: vi.fn() }));
vi.mock("@/lib/ledger/post", () => ({ postPaymentPaid: vi.fn() }));
vi.mock("@/lib/webhooks/dispatch", () => ({ dispatchEvent: vi.fn() }));

import { db } from "@/lib/db/client";
import { claimIncomingTxn } from "@/lib/db/rpc";
import { postPaymentPaid } from "@/lib/ledger/post";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { matchIncomingTxn, matchPayment, type MatchInput } from "../matching/engine";
import { ingestSms } from "../sms/ingest";
import { generateReference } from "@/lib/domain/reference";

// ---------------------------------------------------------------------------
// Fluent Supabase query-builder mock (select/insert/update + eq/in/neq/match/
// order/limit, thenable + maybeSingle/single). Typed with `unknown`/Row so the
// repo's no-explicit-any lint rule stays green.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = [string, unknown, "eq" | "in" | "neq"];
interface Tables {
  payments?: Row[];
  incoming_txns?: Row[];
  wallets?: Row[];
  merchants?: Row[];
}
interface QueryResult {
  data: unknown;
  error: { code?: string } | null;
}
interface Thenable {
  then: (onFulfilled: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) => Promise<unknown>;
}
interface MockQuery extends Thenable {
  select: (cols?: string, opts?: unknown) => MockQuery;
  insert: (rows: Row | Row[]) => MockQuery;
  update: (patch: Row) => MockQuery;
  eq: (c: string, v: unknown) => MockQuery;
  in: (c: string, v: unknown[]) => MockQuery;
  neq: (c: string, v: unknown) => MockQuery;
  is: (c: string, v: unknown) => MockQuery;
  match: (obj: Row) => MockQuery;
  order: (c: string, o?: { ascending?: boolean }) => MockQuery;
  limit: (n: number) => MockQuery;
  maybeSingle: () => Thenable;
  single: () => Thenable;
}

interface MockDbOptions {
  /** Per-table select errors (e.g. merchants lookup failure). */
  errors?: Record<string, { code?: string }>;
  /** Tables whose builder call should throw synchronously. */
  throwOn?: Set<string>;
}

function makeDb(tables: Tables, opts: MockDbOptions = {}) {
  const updates: Array<{ table: string; patch: Row; filters: Filter[] }> = [];
  const { errors = {}, throwOn = new Set<string>() } = opts;

  function builder(table: string): MockQuery {
    const filters: Filter[] = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let insertRows: Row | Row[] | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    function resolveSelect(): Row[] {
      let rows = (tables as Record<string, Row[] | undefined>)[table] ?? [];
      rows = rows.filter((row) =>
        filters.every(([c, v, op]) => {
          if (op === "eq") return row[c] === v;
          if (op === "in") return (v as unknown[]).includes(row[c]);
          return row[c] !== v;
        }),
      );
      if (orderCol) {
        const col = orderCol;
        rows = [...rows].sort((a, b) => ((a[col] as number | string) > (b[col] as number | string) ? 1 : -1) * (orderAsc ? 1 : -1));
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    }

    function result(): QueryResult {
      if (mode === "insert") return { data: insertRows, error: null };
      if (mode === "update") {
        updates.push({ table, patch, filters });
        return { data: null, error: null };
      }
      if (errors[table]) return { data: null, error: errors[table] };
      return { data: resolveSelect(), error: null };
    }

    function asSingle(): Thenable {
      return {
        then: (onFulfilled, onRejected) => {
          const r = result();
          const arr = Array.isArray(r.data) ? (r.data as Row[]) : r.data ? [r.data as Row] : [];
          return Promise.resolve({ data: arr[0] ?? null, error: r.error }).then(onFulfilled, onRejected);
        },
      };
    }

    const api: MockQuery = {
      select: () => api,
      insert: (rows) => {
        mode = "insert";
        insertRows = rows;
        return api;
      },
      update: (p) => {
        mode = "update";
        patch = p;
        return api;
      },
      eq: (c, v) => (filters.push([c, v, "eq"]), api),
      in: (c, v) => (filters.push([c, v, "in"]), api),
      neq: (c, v) => (filters.push([c, v, "neq"]), api),
      is: () => api,
      match: (obj) => {
        for (const [c, v] of Object.entries(obj)) filters.push([c, v, "eq"]);
        return api;
      },
      order: (c, o) => ((orderCol = c), (orderAsc = o?.ascending !== false), api),
      limit: (n) => ((limitN = n), api),
      maybeSingle: () => asSingle(),
      single: () => asSingle(),
      then: (onFulfilled, onRejected) => Promise.resolve(result()).then(onFulfilled, onRejected),
    };
    return api;
  }

  return {
    client: {
      from: (t: string) => {
        if (throwOn.has(t)) throw new Error(`db down for ${t}`);
        return builder(t);
      },
      rpc: vi.fn(),
    } as unknown as ReturnType<typeof db>,
    updates,
  };
}

function useDb(tables: Tables, opts?: MockDbOptions) {
  const { client, updates } = makeDb(tables, opts);
  vi.mocked(db).mockReturnValue(client);
  return { updates };
}

function payment(overrides: Row = {}): Row {
  return {
    id: "pay_1",
    merchant_id: "mer_1",
    plan_id: null,
    provider: "bkash",
    wallet_id: "wal_1",
    offered_wallet_ids: ["wal_1"],
    amount: 120000,
    fee_amount: 6000,
    net_amount: 114000,
    reference: "ABCDEFGH",
    status: "awaiting_payment",
    matched_by: null,
    submitted_trx_id: null,
    expires_at: null,
    callback_url: "https://merchant.test/webhook",
    ...overrides,
  };
}

function baseTxn(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    provider: "bkash",
    trx_id: "TRX1",
    wallet_id: "wal_1",
    amount: 120000,
    balance_after: 120000,
    ref_normalized: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimIncomingTxn).mockResolvedValue(true);
  vi.mocked(postPaymentPaid).mockResolvedValue(undefined);
  vi.mocked(dispatchEvent).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Matching — every SPEC §4 case
// ---------------------------------------------------------------------------

describe("matching engine (SPEC §4)", () => {
  it("rule 1: valid reference + amount/provider/wallet agree → paid (reference)", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));

    expect(res).toMatchObject({ outcome: "paid", matchedBy: "reference", paymentId: "pay_1" });
    expect(claimIncomingTxn).toHaveBeenCalledWith({
      provider: "bkash",
      trxId: "TRX1",
      walletId: "wal_1",
      paymentId: "pay_1",
    });
    expect(postPaymentPaid).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledWith("mer_1", "payment.paid", expect.objectContaining({ status: "paid" }));
  });

  it("amount below expected → needs_review underpaid", async () => {
    const ref = generateReference();
    const { updates } = useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref, amount: 100000 }));

    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "underpaid" });
    expect(postPaymentPaid).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith("mer_1", "payment.needs_review", expect.anything());
    expect(updates.some((u) => u.table === "payments" && u.patch.review_reason === "underpaid")).toBe(true);
  });

  it("amount above expected → needs_review overpaid", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref, amount: 150000 }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "overpaid" });
  });

  it("receiving wallet not in offered_wallet_ids → wrong_wallet", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref, offered_wallet_ids: ["wal_9"], wallet_id: "wal_9" })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "wrong_wallet" });
  });

  it("payment expired → late_payment", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref, status: "expired" })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "late_payment" });
  });

  it("reference already claimed by a paid payment → duplicate_ref", async () => {
    const ref = generateReference();
    useDb({ payments: [payment({ reference: ref, status: "paid" })], incoming_txns: [] });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "duplicate_ref" });
    expect(postPaymentPaid).not.toHaveBeenCalled();
  });

  it("claim lost the race → duplicate_ref", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });
    vi.mocked(claimIncomingTxn).mockResolvedValue(false);

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "duplicate_ref" });
  });

  it("unknown reference → unmatched pool (no payment touched)", async () => {
    const { updates } = useDb({ payments: [], incoming_txns: [] });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: generateReference() }));
    expect(res.outcome).toBe("unmatched");
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === "payments").length).toBe(0);
  });

  it("rule 2: TrxID fallback matches submitted_trx_id → paid (trxid)", async () => {
    useDb({ payments: [payment({ submitted_trx_id: "TRX1" })], incoming_txns: [] });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: null, trx_id: "TRX1" }));
    expect(res).toMatchObject({ outcome: "paid", matchedBy: "trxid" });
  });

  it("reference and TrxID point to different payments → conflict", async () => {
    const ref = generateReference();
    useDb({
      payments: [
        payment({ id: "pay_ref", reference: ref }),
        payment({ id: "pay_trx", reference: "ZZZZZZZZ", submitted_trx_id: "TRX1" }),
      ],
      incoming_txns: [],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "conflict" });
  });

  it("more than one live candidate for the same reference → conflict", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ id: "pay_a", reference: ref }), payment({ id: "pay_b", reference: ref })],
      incoming_txns: [],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "needs_review", reviewReason: "conflict" });
  });
});

// ---------------------------------------------------------------------------
// v3.1 — auto-confirm gate + payment → evidence matcher
// ---------------------------------------------------------------------------

describe("auto-confirm gate (SPEC v3.1 §C)", () => {
  it("reference-only match auto-settles when merchants.auto_confirm is true", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: true }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "paid", matchedBy: "reference" });
  });

  it("reference-only match waits as unmatched when auto_confirm is false", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: false }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res.outcome).toBe("unmatched");
    expect(postPaymentPaid).not.toHaveBeenCalled();
  });

  it("a matching submitted TrxID settles even when auto_confirm is false", async () => {
    const ref = generateReference();
    useDb({
      payments: [payment({ reference: ref, submitted_trx_id: "TRX1" })],
      incoming_txns: [],
      merchants: [{ id: "mer_1", auto_confirm: false }],
    });

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res).toMatchObject({ outcome: "paid", matchedBy: "trxid" });
  });

  it("fails closed: a merchant lookup error does not auto-confirm", async () => {
    const ref = generateReference();
    useDb(
      { payments: [payment({ reference: ref })], incoming_txns: [] },
      { errors: { merchants: { code: "PGRST116" } } },
    );

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res.outcome).toBe("unmatched");
    expect(postPaymentPaid).not.toHaveBeenCalled();
    expect(claimIncomingTxn).not.toHaveBeenCalled();
  });

  it("fails closed: a throwing merchant lookup does not auto-confirm", async () => {
    const ref = generateReference();
    useDb(
      { payments: [payment({ reference: ref })], incoming_txns: [] },
      { throwOn: new Set(["merchants"]) },
    );

    const res = await matchIncomingTxn(baseTxn({ ref_normalized: ref }));
    expect(res.outcome).toBe("unmatched");
    expect(postPaymentPaid).not.toHaveBeenCalled();
    expect(claimIncomingTxn).not.toHaveBeenCalled();
  });
});

describe("matchPayment (SPEC v3.1 §B)", () => {
  it("settles when the claimed TrxID is already stored → paid (trxid)", async () => {
    useDb({
      payments: [payment({ status: "confirming", submitted_trx_id: "TRX1" })],
      incoming_txns: [
        {
          provider: "bkash",
          trx_id: "TRX1",
          wallet_id: "wal_1",
          amount: 120000,
          balance_after: null,
          ref_normalized: null,
          received_at: new Date().toISOString(),
        },
      ],
    });

    const res = await matchPayment("pay_1", { trxId: "TRX1" });
    expect(res).toMatchObject({ status: "paid", matched_by: "trxid" });
  });

  it("returns confirming when no evidence exists yet", async () => {
    useDb({ payments: [payment({ status: "confirming", submitted_trx_id: "TRX1" })], incoming_txns: [] });

    const res = await matchPayment("pay_1", { trxId: "TRX1" });
    expect(res.status).toBe("confirming");
  });

  it("flags conflict when the stored SMS reference belongs to another payment", async () => {
    useDb({
      payments: [payment({ status: "confirming", reference: "ABCDEFGH", submitted_trx_id: null })],
      incoming_txns: [
        {
          provider: "bkash",
          trx_id: "TRX1",
          wallet_id: "wal_1",
          amount: 120000,
          balance_after: null,
          ref_normalized: "ZZZZZZZZ",
          received_at: new Date().toISOString(),
        },
      ],
    });

    const res = await matchPayment("pay_1", { trxId: "TRX1" });
    expect(res).toMatchObject({ status: "needs_review", review_reason: "conflict" });
  });

  it("returns an already terminal payment as-is", async () => {
    useDb({ payments: [payment({ status: "paid", matched_by: "reference" })], incoming_txns: [] });

    const res = await matchPayment("pay_1");
    expect(res).toMatchObject({ status: "paid", matched_by: "reference" });
    expect(claimIncomingTxn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ingest — duplicate client_msg_id, ignored, unparseable, stored
// ---------------------------------------------------------------------------

describe("sms ingest", () => {
  const REF_SMS =
    "You have received Tk 1,200.00 from 01712750278. Fee Tk 0.00. Balance Tk 1,200.00. TrxID DJC9SZQV0J and Ref REF934P923 at 12/10/2026 15:24";
  const wallet: Row = { id: "wal_1", device_id: "dev_1", sim_slot: 0, provider: "bkash" };

  it("dedupes on client_msg_id (no second insert)", async () => {
    const { updates } = useDb({
      incoming_txns: [{ trx_id: "DJC9SZQV0J", client_msg_id: "m1" }],
      wallets: [wallet],
    });

    const res = await ingestSms({
      sender: "bKash",
      body: REF_SMS,
      client_msg_id: "m1",
      device_id: "dev_1",
      sim_slot: 0,
    });

    expect(res).toBe("duplicate");
    expect(updates.length).toBe(0);
  });

  it("garbage SMS with no TrxID → unparseable", async () => {
    useDb({ incoming_txns: [], wallets: [wallet] });

    const res = await ingestSms({
      sender: "bKash",
      body: "Your balance is low. Please recharge.",
      client_msg_id: "m2",
      device_id: "dev_1",
      sim_slot: 0,
    });
    expect(res).toBe("unparseable");
  });

  it("device with no wallet in that SIM slot → ignored", async () => {
    useDb({ incoming_txns: [], wallets: [] });

    const res = await ingestSms({
      sender: "bKash",
      body: REF_SMS,
      client_msg_id: "m3",
      device_id: "dev_missing",
      sim_slot: 0,
    });
    expect(res).toBe("ignored");
  });

  it("stores a parseable SMS and attempts matching → stored", async () => {
    useDb({ incoming_txns: [], wallets: [wallet], payments: [] });

    const res = await ingestSms({
      sender: "bKash",
      body: REF_SMS,
      client_msg_id: "m4",
      device_id: "dev_1",
      sim_slot: 0,
    });
    expect(res).toBe("stored");
  });
});
