/**
 * Client-side authentication surface.
 *
 * IMPORTANT: Supabase Auth is intentionally NOT wired up in this build. There
 * is no live Supabase project, so every function below is a faithful stub that
 * mirrors the intended API shape. The login screen consumes these helpers, so
 * swapping in `@supabase/supabase-js` later is a drop-in change with no UI
 * rework:
 *
 *   const supabase = createBrowserClient(url, anonKey);
 *   const { data, error } = await supabase.auth.signInWithPassword(...);
 *
 * Until then `signIn` resolves to a typed "not connected" result so the UI can
 * explain the pending wiring instead of pretending to authenticate.
 */

export interface SignInInput {
  email: string;
  password: string;
  /** Optional 6-digit TOTP, required for owner/staff accounts (SPEC §9). */
  totp?: string;
}

export type SignInResult =
  | { ok: true; userId: string }
  | { ok: false; code: string; message: string };

/** True while the Supabase Auth project is not yet provisioned. */
export const AUTH_WIRING_PENDING = true;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function signIn(input: SignInInput): Promise<SignInResult> {
  // Keep the reference so the stub signature stays honest about its input.
  void input;
  await delay(240);
  return {
    ok: false,
    code: "auth_pending",
    message:
      "Authentication is not connected yet. Supabase Auth wiring is pending, so sign-in is unavailable in this build.",
  };
}

export async function signOut(): Promise<void> {
  await delay(0);
}

export async function getSession(): Promise<{ userId: string } | null> {
  return null;
}
