/**
 * Client query-builder tests for the merchant payments list.
 *
 * `GET /v1/payments` validates its query with a `.strict()` zod schema that
 * accepts only `status | provider | limit | cursor`; sending anything else
 * (notably the search term `q`) returns 400 on every keystroke. The payments
 * page filters by search text locally, so `q` must stay off the wire.
 *
 * Run: `npx vitest run src/lib/__tests__/client-query.test.ts`
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPayments } from "@/lib/client/query";

function okJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Capture the URL string `getPayments` fetches and stub a successful list. */
function captureFetch(): { url: () => string } {
  // Typed as `fetch` so the captured call args are indexable without declaring
  // (and then not using) throwaway parameters.
  const fetchMock = vi.fn<typeof fetch>(async () => okJson({ data: [] }));
  vi.stubGlobal("fetch", fetchMock);
  return {
    url: () => String(fetchMock.mock.calls[0]?.[0] ?? ""),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client/query getPayments", () => {
  it("never sends the unsupported `q` param, but keeps schema-accepted ones", async () => {
    const { url } = captureFetch();

    await getPayments({ q: "abc123", status: "paid", provider: "bkash", limit: 50 });

    expect(url()).toBe("/v1/payments?status=paid&provider=bkash&limit=50");
    expect(url()).not.toContain("q=");
  });

  it("drops `q` even when it is the only filter", async () => {
    const { url } = captureFetch();

    await getPayments({ q: "9A1B2C3D" });

    expect(url()).toBe("/v1/payments");
  });
});
