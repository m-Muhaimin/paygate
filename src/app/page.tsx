import {
  ArrowUpRight,
  CreditCard,
  Fingerprint,
  Gauge,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LinkButton } from "@/components/app/link-button";
import { ReferenceChip, StatusChip } from "@/components/gate";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "PayGate - Wallet payments for Bangladeshi merchants",
  description:
    "PayGate turns your bKash, Nagad or Rocket number into a hosted pay page with a single-use reference for every customer. No provider API needed.",
};

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-gate-bg text-gate-ink">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-gate-48 px-gate-16 pt-gate-16 pb-gate-40 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-gate-24 lg:py-gate-40">
          <div className="flex flex-col items-start gap-gate-20">
            <p className="inline-flex items-center gap-gate-8 rounded-gate-pill border border-gate-border bg-gate-surface px-gate-12 py-gate-6 text-gate-caption font-medium text-gate-ink-2">
              <span className="size-2 rounded-gate-pill bg-gate-accent" aria-hidden="true" />
              For merchants in Bangladesh
            </p>
            <h1 className="max-w-[18ch] text-gate-display font-semibold tracking-tight text-gate-ink md:text-[44px] md:leading-[1.15]">
              Turn your wallet number into a payment link.
            </h1>
            <p className="max-w-[52ch] text-gate-body-mobile text-gate-ink-2 md:text-gate-h2 md:leading-relaxed">
              PayGate gives your bKash, Nagad or Rocket number a hosted pay
              page with a single-use reference for every customer. We match the
              money, you get paid.
            </p>
            <div className="flex flex-col gap-gate-12 sm:flex-row">
              <LinkButton href="/registration" size="lg">
                Start accepting payments
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </LinkButton>
              <LinkButton href="#how" variant="secondary" size="lg">
                See how it works
              </LinkButton>
            </div>
            <p className="text-gate-caption text-gate-ink-2">
              Go live in minutes. No SDK, no approval queue, no terminal.
            </p>
          </div>

          <PayPreview />
        </section>

        {/* Provider strip */}
        <section className="border-y border-gate-border bg-gate-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-gate-16 px-gate-16 py-gate-24 md:flex-row md:justify-between">
            <p className="text-gate-caption font-medium text-gate-ink-2">
              Works with the wallets your customers already have
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-gate-20">
              {(
                [
                  { name: "bKash", dot: "bg-gate-provider-bkash" },
                  { name: "Nagad", dot: "bg-gate-provider-nagad" },
                  { name: "Rocket", dot: "bg-gate-provider-rocket" },
                ] as const
              ).map(({ name, dot }) => (
                <li
                  key={name}
                  className="inline-flex items-center gap-gate-8 text-gate-h3 font-semibold text-gate-ink"
                >
                  <span
                    className={cn("size-2.5 rounded-gate-pill", dot)}
                    aria-hidden="true"
                  />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto w-full max-w-6xl px-gate-16 py-gate-40">
          <div className="max-w-[40ch]">
            <p className="text-gate-caption font-medium text-gate-accent">
              How it works
            </p>
            <h2 className="mt-gate-8 text-gate-display font-semibold tracking-tight text-gate-ink">
              Three steps to your first payment.
            </h2>
          </div>

          <ol className="mt-gate-32 grid gap-gate-16 md:grid-cols-3">
            {STEPS.map(({ Icon, title, body }, index) => (
              <li
                key={title}
                className="flex flex-col gap-gate-12 rounded-gate-card border border-gate-border bg-gate-surface p-gate-20"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-gate-pill bg-gate-accent-soft">
                    <Icon className="size-5 text-gate-accent" aria-hidden="true" />
                  </span>
                  <span className="font-gate-mono text-gate-mono text-gate-ink-3">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="text-gate-h3 font-semibold text-gate-ink">
                  {title}
                </h3>
                <p className="text-gate-body text-gate-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Trust */}
        <section className="border-t border-gate-border bg-gate-surface">
          <div className="mx-auto grid w-full max-w-6xl gap-gate-16 px-gate-16 py-gate-32 md:grid-cols-2">
            {TRUST.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="flex items-start gap-gate-16 rounded-gate-card border border-gate-border bg-gate-bg p-gate-20"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-gate-pill bg-gate-surface-2">
                  <Icon className="size-5 text-gate-ink" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-gate-h3 font-semibold text-gate-ink">
                    {title}
                  </h3>
                  <p className="mt-gate-4 max-w-[52ch] text-gate-body text-gate-ink-2">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-gate-16 py-gate-40">
          <div className="flex flex-col items-center gap-gate-16 rounded-gate-card border border-gate-border bg-gate-surface p-gate-32 text-center">
            <h2 className="max-w-[22ch] text-gate-display font-semibold tracking-tight text-gate-ink">
              Ready to take your first wallet payment?
            </h2>
            <p className="max-w-[44ch] text-gate-body-mobile text-gate-ink-2">
              Register your business in a few minutes. We review it, then you
              share a link and get paid.
            </p>
            <div className="flex flex-col gap-gate-12 sm:flex-row">
              <LinkButton href="/registration" size="lg">
                Start accepting payments
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </LinkButton>
              <LinkButton href="/login" variant="secondary" size="lg">
                Sign in
              </LinkButton>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

const STEPS = [
  {
    Icon: CreditCard,
    title: "Share a link",
    body: "Create a pay link for any amount in seconds. Every link carries one 8-character reference, so each payment maps to exactly one customer.",
  },
  {
    Icon: Smartphone,
    title: "They send money",
    body: "Your customer opens the hosted page, takes the wallet number, and sends money from bKash, Nagad or Rocket with the reference in the note.",
  },
  {
    Icon: Fingerprint,
    title: "We match and pay out",
    body: "PayGate detects the incoming payment, matches it to the reference, and updates your balance. You always know who paid and when.",
  },
] as const;

const TRUST = [
  {
    Icon: Fingerprint,
    title: "Every payment accounted for",
    body: "Single-use references plus an optional TrxID fallback mean a payment is never lost in the noise. Anything we cannot match goes to a review queue, not a mystery.",
  },
  {
    Icon: Gauge,
    title: "Priced like a payment company",
    body: "A flat 5% only on successful payments. No setup fee, no monthly fee, no charge when a customer abandons the link.",
  },
  {
    Icon: Smartphone,
    title: "Run from a phone",
    body: "Pair your wallet SIM as the payment terminal. No card reader, no extra hardware, no provider API to negotiate.",
  },
  {
    Icon: ShieldCheck,
    title: "Built for trust",
    body: "Payments move wallet-to-wallet inside bKash, Nagad and Rocket. PayGate never handles card numbers or holds your customers' money.",
  },
] as const;

function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-gate-border/60 bg-gate-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-gate-12 px-gate-16">
        <Link href="/" className="inline-flex items-center gap-gate-8">
          <span className="grid size-7 place-items-center rounded-gate-input bg-gate-ink text-gate-caption font-semibold text-gate-bg">
            P
          </span>
          <span className="text-gate-h3 font-semibold tracking-tight text-gate-ink">
            PayGate
          </span>
        </Link>
        <nav className="flex items-center gap-gate-8">
          <LinkButton href="/login" variant="ghost" size="md">
            Sign in
          </LinkButton>
          <LinkButton href="/registration" size="md">
            Start accepting payments
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-gate-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-gate-16 px-gate-16 py-gate-24 md:flex-row">
        <div className="flex items-center gap-gate-8">
          <span className="grid size-6 place-items-center rounded-gate-input bg-gate-ink text-gate-caption font-semibold text-gate-bg">
            P
          </span>
          <span className="text-gate-h3 font-semibold tracking-tight text-gate-ink">
            PayGate
          </span>
        </div>
        <p className="text-gate-caption text-gate-ink-2">
          &copy; 2026 PayGate. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/** A static model of the hosted pay page, labelled so visitors understand it. */
function PayPreview() {
  return (
    <div className="mx-auto w-full max-w-[26rem]">
      <p className="mb-gate-12 text-center text-gate-caption font-medium text-gate-ink-2">
        What your customer sees
      </p>
      <div className="overflow-hidden rounded-gate-card border border-gate-border bg-gate-surface shadow-[0_24px_60px_-32px_rgba(14,14,17,0.35)]">
        <div className="flex flex-col gap-gate-16 p-gate-20">
          <div className="flex items-center justify-between gap-gate-12">
            <span className="inline-flex items-center gap-gate-8">
              <span
                className="size-3 rounded-gate-pill bg-gate-provider-bkash"
                aria-hidden="true"
              />
              <span className="text-gate-h3 font-semibold text-gate-ink">
                bKash
              </span>
            </span>
            <StatusChip status="awaiting_payment" />
          </div>
          <div>
            <p className="text-gate-caption text-gate-ink-2">Amount</p>
            <p className="font-gate-mono text-gate-display font-semibold tabular-nums text-gate-ink">
              &#2547;1,250.00
            </p>
          </div>
        </div>
        <div className="border-t border-gate-border p-gate-20">
          <div className="flex flex-col items-center gap-gate-8 text-center">
            <p className="text-gate-caption font-medium text-gate-ink-2">
              Your reference
            </p>
            <ReferenceChip reference="8A2C4F91" label="Payment reference" />
          </div>
        </div>
      </div>
    </div>
  );
}