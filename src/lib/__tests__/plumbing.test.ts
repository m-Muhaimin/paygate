/**
 * Unit tests for the shared backend plumbing (mocked `db()`).
 * Run: `npx vitest run src/lib/__tests__/plumbing.test.ts`
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
import { verifySecret } from "@/lib/api/crypto";
import { findByIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getBearerToken, generateApiKey, hashApiKey, maskApiKey } from "@/lib/api/keys";
import { clientIp, enforceRateLimit, rateLimit } from "@/lib/api/ratelimit";
import { authenticateMerchant } from "@/lib/api/tenant";
import type { Payment } from "@/lib/db/types";

interface SupabaseResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * Minimal chainable PostgREST-builder stand-in. Every filter method returns the
 * same builder; terminal methods (`maybeSingle`/`single`) and `await` resolve the
 * configured result.
 */
function query(result: SupabaseResult, write?: SupabaseResult): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "not", "contains"]) {
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

function bearerRequest(token?: string): Request {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  return new Request("https://paygate.test/v1/payments", { headers });
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("api/keys", () => {
  it("mints, hashes, verifies and masks an API key round-trip", async () => {
    const live = await generateApiKey("live");
    expect(live.prefix).toBe("sk_live_");
    expect(live.plaintext.startsWith("sk_live_")).toBe(true);
    expect(live.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiKey(live.plaintext)).toBe(live.hash);
    expect(await verifySecret(live.plaintext, live.hash)).toBe(true);

    const masked = maskApiKey(live.plaintext);
    expect(masked).toBe(`sk_live_…${live.plaintext.slice(-4)}`);
    expect(masked).toMatch(/^sk_live_…[0-9a-f]{4}$/);
    expect(masked).not.toContain(live.plaintext.slice(11, 30));

    const test = await generateApiKey("test");
    expect(test.prefix).toBe("sk_test_");
    expect(maskApiKey(test.plaintext)).toMatch(/^sk_test_…[0-9a-f]{4}$/);
  });

  it("parses a bearer header and rejects malformed ones", () => {
    expect(getBearerToken(bearerRequest("sk_live_abc"))).toBe("sk_live_abc");
    expect(getBearerToken(new Request("https://paygate.test", { headers: { authorization: "Token x" } }))).toBeNull();
    expect(getBearerToken(new Request("https://paygate.test"))).toBeNull();
  });
});

describe("api/ratelimit", () => {
  it("allows up to the limit, blocks the next, and reports retryAfter", () => {
    const key = `t-${crypto.randomUUID()}`;
    const t0 = 1_000_000;

    expect(rateLimit(key, 2, 60, t0)).toEqual({ ok: true, remaining: 1, retryAfter: 0 });
    expect(rateLimit(key, 2, 60, t0 + 1_000)).toEqual({ ok: true, remaining: 0, retryAfter: 0 });

    const blocked = rateLimit(key, 2, 60, t0 + 2_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBe(58); // oldest hit at t0, window 60s, now t0+2s

    // Once the window slides past both hits, a new request is allowed again.
    expect(rateLimit(key, 2, 60, t0 + 61_000).ok).toBe(true);
  });

  it("enforceRateLimit throws 429 with retry_after in details", () => {
    const bucket = `b-${crypto.randomUUID()}`;
    const req = new Request("https://paygate.test/v1/pay/pay_1", {
      headers: { "x-forwarded-for": "203.0.113.7, 198.51.100.9" },    });
    enforceRateLimit(req, bucket, 1, 60);

    let caught: unknown;
    try {
      enforceRateLimit(req, bucket, 1, 60);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(429);
    expect(apiError.code).toBe("too_many_requests");
    expect((apiError.details as { retry_after: number }).retry_after).toBeGreaterThanOrEqual(1);
    expect(clientIp(req)).toBe("203.0.113.7");
  });
});

describe("api/idempotency", () => {
  it("returns the existing payment on a replayed key without running fn", async () => {
    const existing = { id: "pay_1", merchant_id: "mer_1" } as unknown as Payment;
    fromMock.mockReturnValueOnce(query({ data: existing, error: null }));

    const fn = vi.fn(async (): Promise<Payment> => {
      throw new Error("fn must not run for a replayed key");
    });

    const result = await withIdempotency("mer_1", "key-1", fn);
    expect(result).toBe(existing);
    expect(fn).not.toHaveBeenCalled();
  });

  it("creates via fn when the key is new", async () => {
    const created = { id: "pay_2", merchant_id: "mer_1" } as unknown as Payment;
    fromMock.mockReturnValueOnce(query({ data: null, error: null }));

    const fn = vi.fn(async (): Promise<Payment> => created);
    const result = await withIdempotency("mer_1", "key-2", fn);
    expect(result).toBe(created);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns the existing payment on the second call with the same key", async () => {
    const created = { id: "pay_dup", merchant_id: "mer_1" } as unknown as Payment;
    const fn = vi.fn(async (): Promise<Payment> => created);
    fromMock
      .mockReturnValueOnce(query({ data: null, error: null })) // first call: key unused
      .mockReturnValueOnce(query({ data: created, error: null })); // second call: key used

    const first = await withIdempotency("mer_1", "dup", fn);
    const second = await withIdempotency("mer_1", "dup", fn);
    expect(first).toBe(created);
    expect(second).toBe(created);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs fn unconditionally when no key is supplied", async () => {
    const created = { id: "pay_3", merchant_id: "mer_1" } as unknown as Payment;
    const fn = vi.fn(async (): Promise<Payment> => created);
    expect(await withIdempotency("mer_1", null, fn)).toBe(created);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("findByIdempotencyKey returns the row or null", async () => {
    fromMock.mockReturnValueOnce(query({ data: { id: "pay_9" }, error: null }));
    expect((await findByIdempotencyKey("mer_1", "k"))?.id).toBe("pay_9");

    fromMock.mockReturnValueOnce(query({ data: null, error: null }));
    expect(await findByIdempotencyKey("mer_1", "k2")).toBeNull();
  });
});

describe("api/tenant.authenticateMerchant", () => {
  it("rejects a missing bearer token with 401 and never hits the DB", async () => {
    await expect(authenticateMerchant(bearerRequest())).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a non-merchant (non sk_) bearer token with 401", async () => {
    await expect(authenticateMerchant(bearerRequest("device-token-abcd"))).rejects.toMatchObject({
      status: 401,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown/revoked API key with 401", async () => {
    fromMock.mockReturnValueOnce(query({ data: null, error: null }));
    await expect(
      authenticateMerchant(bearerRequest(`sk_test_${"a".repeat(64)}`)),
    ).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });

  it("rejects a valid key whose merchant is not active", async () => {
    fromMock
      .mockReturnValueOnce(query({ data: { id: "key_1", merchant_id: "mer_1" }, error: null }))
      .mockReturnValueOnce(query({ data: { id: "mer_1", status: "suspended" }, error: null }));
    await expect(
      authenticateMerchant(bearerRequest(`sk_live_${"b".repeat(64)}`)),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("authenticates a valid key for an active merchant and stamps last_used_at", async () => {
    fromMock
      .mockReturnValueOnce(query({ data: { id: "key_1", merchant_id: "mer_1" }, error: null }))
      .mockReturnValueOnce(query({ data: { id: "mer_1", name: "Acme", status: "active" }, error: null }))
      .mockReturnValueOnce(query({ data: null, error: null }));

    const { merchant } = await authenticateMerchant(bearerRequest(`sk_test_${"c".repeat(64)}`));
    expect(merchant.id).toBe("mer_1");
    expect(fromMock).toHaveBeenCalledTimes(3);
  });
});
