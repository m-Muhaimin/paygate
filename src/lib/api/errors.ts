/**
 * Typed API errors and factory helpers. Route handlers throw these and the
 * http layer serialises them to `{ error: { code, message, request_id } }`
 * (SPEC §7).
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 400 — malformed request. */
export function badRequest(message = "Bad request", details?: unknown): ApiError {
  return new ApiError("bad_request", 400, message, details);
}

/** 401 — missing or invalid credentials. */
export function unauthorized(message = "Unauthorized", details?: unknown): ApiError {
  return new ApiError("unauthorized", 401, message, details);
}

/** 403 — authenticated but not permitted. */
export function forbidden(message = "Forbidden", details?: unknown): ApiError {
  return new ApiError("forbidden", 403, message, details);
}

/** 404 — resource does not exist. */
export function notFound(message = "Not found", details?: unknown): ApiError {
  return new ApiError("not_found", 404, message, details);
}

/** 409 — conflicting state (e.g. duplicate reference). */
export function conflict(message = "Conflict", details?: unknown): ApiError {
  return new ApiError("conflict", 409, message, details);
}

/** 422 — syntactically valid but semantically rejected. */
export function unprocessable(message = "Unprocessable entity", details?: unknown): ApiError {
  return new ApiError("unprocessable", 422, message, details);
}

/** 429 — rate limited. */
export function tooManyRequests(message = "Too many requests", details?: unknown): ApiError {
  return new ApiError("too_many_requests", 429, message, details);
}

/** 503 — no live wallet can accept this payment (SPEC §5). */
export function noWalletAvailable(message = "No wallet available", details?: unknown): ApiError {
  return new ApiError("no_wallet_available", 503, message, details);
}

/** 500 — unexpected server failure. */
export function internal(message = "Internal server error", details?: unknown): ApiError {
  return new ApiError("internal_error", 500, message, details);
}
