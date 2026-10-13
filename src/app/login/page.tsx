"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";

import { Banner, Button, Input } from "@/components/gate";
import { signIn, type SignInResult } from "@/lib/client/auth";
import { AUTH_WIRING_PENDING } from "@/lib/client/auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [totp, setTotp] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<SignInResult | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setResult(null);
    const res = await signIn({ email, password, totp: totp || undefined });
    setResult(res);
    setPending(false);
    if (res.ok) {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-dvh bg-gate-bg text-gate-ink">
      <header className="mx-auto flex w-full max-w-[28rem] items-center justify-center px-gate-16 py-gate-20">
        <Link href="/" className="inline-flex items-center gap-gate-8">
          <span className="grid size-7 place-items-center rounded-gate-input bg-gate-ink text-gate-caption font-semibold text-gate-bg">
            P
          </span>
          <span className="text-gate-h3 font-semibold tracking-tight text-gate-ink">
            PayGate
          </span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[28rem] flex-col px-gate-16 pb-gate-32">
        <div className="mb-gate-20 text-center">
          <h1 className="text-gate-display font-semibold tracking-tight text-gate-ink">
            Welcome back
          </h1>
          <p className="mx-auto mt-gate-8 max-w-[40ch] text-gate-body-mobile text-gate-ink-2">
            Sign in to manage your pay links and see your settlements.
          </p>
        </div>

        <div className="rounded-gate-card border border-gate-border bg-gate-surface p-gate-20 md:p-gate-24">
          {result && !result.ok ? (
            <div className="mb-gate-16">
              <Banner
                variant="warning"
                title={
                  AUTH_WIRING_PENDING
                    ? "Sign-in is not connected yet"
                    : "We could not sign you in"
                }
                description={
                  AUTH_WIRING_PENDING
                    ? "PayGate is provisioning its auth provider. You will be able to sign in here once that lands. Meanwhile, your customer-facing pay links work as normal."
                    : result.message
                }
              />
            </div>
          ) : null}

          <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-gate-16" noValidate>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Input
              label="Authenticator code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="123456"
              hint="Required for staff accounts that have two-factor enabled."
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ""))}
            />

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={pending}
              className="mt-gate-8"
            >
              Sign in
            </Button>
          </form>

          <p className="mt-gate-16 text-center text-gate-caption text-gate-ink-2">
            New to PayGate?{" "}
            <Link
              href="/registration"
              className="font-medium text-gate-ink underline-offset-4 hover:underline"
            >
              Register your business
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}