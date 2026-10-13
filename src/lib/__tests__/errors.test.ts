import { describe, expect, it } from "vitest";

import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  internal,
  noWalletAvailable,
  notFound,
  tooManyRequests,
  unauthorized,
  unprocessable,
} from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/http";

describe("ApiError factories", () => {
  const cases: Array<[() => ApiError, number, string]> = [
    [badRequest, 400, "bad_request"],
    [unauthorized, 401, "unauthorized"],
    [forbidden, 403, "forbidden"],
    [notFound, 404, "not_found"],
    [conflict, 409, "conflict"],
    [unprocessable, 422, "unprocessable"],
    [tooManyRequests, 429, "too_many_requests"],
    [noWalletAvailable, 503, "no_wallet_available"],
    [internal, 500, "internal_error"],
  ];

  it.each(cases)("maps to the right status and code", (make, status, code) => {
    const err = make();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(typeof err.message).toBe("string");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("carries a custom message and details", () => {
    const err = unprocessable("amount mismatch", { expected: 120000, got: 100000 });
    expect(err.message).toBe("amount mismatch");
    expect(err.details).toEqual({ expected: 120000, got: 100000 });
  });

  it("exposes no_wallet_available as a 503", () => {
    const err = noWalletAvailable();
    expect(err.status).toBe(503);
    expect(err.code).toBe("no_wallet_available");
  });
});

describe("errorResponse", () => {
  const requestId = "req_test_1";

  it("serialises ApiError with its status and the canonical envelope", async () => {
    const res = errorResponse(noWalletAvailable(), requestId);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "no_wallet_available",
        message: "No wallet available",
        request_id: requestId,
      },
    });
  });

  it("includes details when present", async () => {
    const res = errorResponse(badRequest("bad input", { field: "plan_id" }), requestId);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details).toEqual({ field: "plan_id" });
    expect(body.error.request_id).toBe(requestId);
  });

  it("maps unknown errors to a 500 without leaking internals", async () => {
    const res = errorResponse(new Error("secret database exploded"), requestId);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "internal_error",
        message: "Internal server error",
        request_id: requestId,
      },
    });
  });
});
