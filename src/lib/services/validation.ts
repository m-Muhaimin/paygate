/**
 * Small request-parsing helpers shared by the `/v1` route handlers.
 *
 * Kept here (rather than in the routes) so every endpoint turns malformed input
 * into the same canonical `400 bad_request` envelope (SPEC §7), and so the zod
 * error details are attached consistently.
 */

import type { ZodType } from "zod";

import { badRequest } from "@/lib/api/errors";

/**
 * Read a JSON request body, turning unreadable/invalid JSON into a `400`.
 * An empty body is treated as `{}` so missing-field validation reports the real
 * missing fields instead of a JSON parse error.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw badRequest("Could not read request body");
  }
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

/** Parse `data` against `schema`, throwing a `400 bad_request` (with details) on failure. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown, message: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw badRequest(message, parsed.error.flatten());
  }
  return parsed.data;
}
