/**
 * Lazy Supabase JS clients for the server (route handlers, services, jobs).
 *
 * Privileged path: `db()` prefers the server-only `SUPABASE_SERVICE_ROLE_KEY`
 * (BYPASSRLS — the trusted server path for the PayGate API) and falls back to the
 * browser-safe `NEXT_PUBLIC_SUPABASE_ANON_KEY` when it is absent, so read-only/dev
 * environments still work. Env is read lazily inside the functions so `next build`
 * never requires secrets at import time.
 *
 * `dbAsUser(accessToken)` scopes a client to an end-user JWT so Postgres RLS runs
 * as that user (used by the merchant dashboard path — dashboard reads go through
 * RLS, the API path goes through `service_role`).
 *
 * Table-name note: PayGate owns its own Supabase project/schema, so tables use the
 * unprefixed names from `docs/db-schema.md` (`payments`, `api_keys`, ...). The
 * shared-project `<PREFIX>_<table>` convention does not apply to this database.
 *
 * Env vars:
 *   NEXT_PUBLIC_SUPABASE_URL            (required)
 *   SUPABASE_SERVICE_ROLE_KEY           (server-only; preferred when set)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY       (fallback / RLS-scoped user client)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { internal } from "@/lib/api/errors";

/** Cached privileged/anon client, keyed by (url, key) so a key rotation rebuilds it. */
let cached: { url: string; key: string; client: SupabaseClient } | null = null;

function readServerEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw internal(
      "Supabase is not configured (set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return { url, key };
}

/** True when the privileged `service_role` key is configured (RLS is bypassed). */
export function isPrivileged(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Lazy, cached server client. Prefers `service_role`, falls back to anon. */
export function db(): SupabaseClient {
  const { url, key } = readServerEnv();
  if (cached && cached.url === url && cached.key === key) return cached.client;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = { url, key, client };
  return client;
}

/**
 * A client scoped to an end-user access token: requests carry
 * `Authorization: Bearer <accessToken>` and run under Postgres RLS as that user.
 * Always built with the anon key so the RLS policy (not the service key) decides.
 */
export function dbAsUser(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw internal(
      "Supabase is not configured (set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
