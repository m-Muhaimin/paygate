/**
 * In-memory sliding-window rate limiter.
 *
 * ⚠️ Per-instance only. State lives in module scope, so on Vercel each serverless
 * instance (and each region) holds its own counters: limits are approximate and
 * reset on cold start. That is acceptable for the SPEC §7 public endpoints
 * (`/v1/pay/:id` 10/min/IP, webhooks 60/min) as a first line of defence.
 *
 * Upgrade path (same call sites, no API change): back `rateLimit()` with
 * Upstash Redis (`@upstash/ratelimit`, sliding window) or a Postgres counter table
 * (`insert ... on conflict` + a `pg_cron` sweep) for a globally consistent limit.
 */

import { tooManyRequests } from "@/lib/api/errors";

export interface RateLimitResult {
  ok: boolean;
  /** Requests remaining in the current window after this call. */
  remaining: number;
  /** Seconds until the window frees a slot (0 when allowed). */
  retryAfter: number;
}

/** key -> sorted epoch-ms timestamps of accepted requests still inside the window. */
const windows = new Map<string, number[]>();

/** Sweep stale buckets once the map grows past this size (bounds memory). */
const SWEEP_THRESHOLD = 10_000;
const STALE_MS = 86_400_000; // 24h

function sweep(now: number): void {
  if (windows.size <= SWEEP_THRESHOLD) return;
  const staleBefore = now - STALE_MS;
  for (const [key, hits] of windows) {
    const last = hits[hits.length - 1];
    if (last === undefined || last < staleBefore) windows.delete(key);
  }
}

/**
 * Record an attempt against `key` and report whether it is allowed.
 *
 * @param key       bucket identity, e.g. `pay:<ip>`.
 * @param limit     max accepted requests per window.
 * @param windowSec sliding window length in seconds.
 * @param now       epoch-ms clock override (tests).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): RateLimitResult {
  const windowMs = windowSec * 1000;
  const cutoff = now - windowMs;

  let hits = windows.get(key);
  if (!hits) {
    hits = [];
    windows.set(key, hits);
  } else {
    // Drop timestamps that have fallen out of the window.
    let expired = 0;
    while (expired < hits.length && hits[expired] <= cutoff) expired++;
    if (expired > 0) hits.splice(0, expired);
  }

  if (hits.length >= limit) {
    const oldest = hits[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfter };
  }

  hits.push(now);
  sweep(now);
  return { ok: true, remaining: Math.max(0, limit - hits.length), retryAfter: 0 };
}

/** Best-effort client IP: `x-forwarded-for` (first hop) then `x-real-ip`. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

/**
 * Enforce a per-IP limit for a named bucket, throwing `tooManyRequests()` (429) when
 * exceeded. The `details.retry_after` (seconds) field carries the window reset so the
 * caller can emit the `Retry-After` response header.
 *
 * NOTE: the canonical error envelope (`errorResponse` in `@/lib/api/http`) does not
 * copy `details.retry_after` into a header — route handlers that need the actual
 * `Retry-After` header should read `details.retry_after` from the thrown `ApiError`
 * (or call `rateLimit()` directly) and set it on the response.
 */
export function enforceRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowSec: number,
): void {
  const result = rateLimit(`${bucket}:${clientIp(req)}`, limit, windowSec);
  if (!result.ok) {
    throw tooManyRequests("Rate limit exceeded", {
      bucket,
      limit,
      window_sec: windowSec,
      retry_after: result.retryAfter,
    });
  }
}
