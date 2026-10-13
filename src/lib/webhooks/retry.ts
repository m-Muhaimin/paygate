/**
 * Webhook retry helpers (SPEC §8).
 *
 * The delivery attempt itself lives in `./dispatch`; this module re-exports it
 * together with the exponential backoff schedule so callers (cron/reaper jobs)
 * import one place.
 */

export { attemptDelivery, RETRY_SCHEDULE_SECONDS, nextRetryDelaySeconds } from "./dispatch";

/** Alias used by the worker/cron: seconds between successive retries. */
export const RETRY_SCHEDULE = [10, 60, 300, 1800, 7200, 21600, 86400] as const;
