/**
 * HTTP helpers for Route Handlers: JSON responses, request-id propagation,
 * structured logging and uniform error serialisation (SPEC §7).
 */

import { ApiError } from "./errors";

/** Build a JSON `Response`, defaulting the content type when not supplied. */
export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** Read an inbound `x-request-id`, or generate one when absent. */
export function getRequestId(req: Request): string {
  const header = req.headers.get("x-request-id");
  if (header && header.trim().length > 0) return header.trim();
  return crypto.randomUUID();
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Emit one structured JSON log line: `{ level, request_id, msg, ... }`. */
export function logStructured(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  const { request_id = null, ...rest } = fields;
  const line = JSON.stringify({ level, request_id, msg, ...rest });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Serialise any thrown value to the canonical error envelope with the correct
 * status. `ApiError`s map 1:1; anything else becomes a 500 without leaking
 * internals to the caller.
 */
export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    const error: { code: string; message: string; request_id: string; details?: unknown } = {
      code: err.code,
      message: err.message,
      request_id: requestId,
    };
    if (err.details !== undefined) error.details = err.details;
    return json({ error }, { status: err.status });
  }

  logStructured("error", "unhandled_error", {
    request_id: requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  return json(
    { error: { code: "internal_error", message: "Internal server error", request_id: requestId } },
    { status: 500 },
  );
}

export type RequestHandler = (req: Request, requestId: string) => Promise<Response> | Response;

/**
 * Wrap a route handler so every call has a request id, echoes it back in the
 * `x-request-id` response header, and logs a structured request line. Thrown
 * `ApiError`s (or any error) are converted via `errorResponse`.
 */
export function withRequestId(handler: RequestHandler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = getRequestId(req);
    const startedAt = Date.now();
    try {
      const res = await handler(req, requestId);
      res.headers.set("x-request-id", requestId);
      logStructured("info", "request", {
        request_id: requestId,
        method: req.method,
        url: req.url,
        status: res.status,
        duration_ms: Date.now() - startedAt,
      });
      return res;
    } catch (err) {
      const res = errorResponse(err, requestId);
      res.headers.set("x-request-id", requestId);
      logStructured("error", "request_failed", {
        request_id: requestId,
        method: req.method,
        url: req.url,
        status: res.status,
        duration_ms: Date.now() - startedAt,
      });
      return res;
    }
  };
}
