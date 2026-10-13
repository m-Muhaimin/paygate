"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Landmark, Smartphone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import type { FieldErrors } from "react-hook-form";
import { z } from "zod";

import { DrawnCheck } from "@/components/app/drawn-check";
import { Select } from "@/components/app/select";
import { Banner, Button, Input } from "@/components/gate";
import { applyOnboarding } from "@/lib/client/api";
import type { OnboardingApplyInput } from "@/lib/client/api";
import { isApiClientError } from "@/lib/client/query";
import { cn } from "@/lib/utils";

const MFS_PHONE_RE = /^01[0-9]{9}$/;

const schema = z.object({
  name: z.string().trim().min(1, "Enter your business name.").max(200),
  email: z.string().trim().email("Enter a valid email address.").max(320),
  phone: z
    .string()
    .trim()
    .regex(/^01[0-9]{9}$/, "Enter a valid Bangladeshi mobile number (01XXXXXXXXX)."),
  business_type: z.string().trim().min(1, "Choose a business type.").max(120),
  payout_account: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("mfs"),
      provider: z.enum(["bkash", "nagad", "rocket"], {
        errorMap: () => ({ message: "Choose a wallet provider." }),
      }),
      account_no: z
        .string()
        .trim()
        .regex(MFS_PHONE_RE, "Enter the wallet phone number (01XXXXXXXXX)."),
      holder: z
        .string()
        .trim()
        .min(1, "Enter the account holder name.")
        .max(200),
    }),
    z.object({
      type: z.literal("bank"),
      bank_name: z
        .string()
        .trim()
        .min(1, "Enter the bank name.")
        .max(200),
      account_no: z
        .string()
        .trim()
        .min(1, "Enter the account number.")
        .max(64),
      holder: z
        .string()
        .trim()
        .min(1, "Enter the account holder name.")
        .max(200),
    }),
  ]),
});

type FormValues = z.infer<typeof schema>;

const BUSINESS_TYPES = [
  { value: "retail", label: "Retail store" },
  { value: "services", label: "Services (fitness, repair, consulting)" },
  { value: "saas", label: "SaaS and digital products" },
  { value: "education", label: "Education and coaching" },
  { value: "food", label: "Food and hospitality" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "other", label: "Other" },
] as const;

const MFS_PROVIDERS = [
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
] as const;

export default function RegistrationPage() {
  const [payoutType, setPayoutType] = React.useState<"mfs" | "bank">("mfs");

  const mutation = useMutation({
    mutationFn: (input: OnboardingApplyInput) => applyOnboarding(input),
  });

  /** Reads a field error off a discriminated-union `payout_account` error. */
  const unionFieldError = (
    errors: FieldErrors<FormValues>["payout_account"],
    key: "provider" | "bank_name",
  ): string | undefined => {
    if (!errors) return undefined;
    return (errors as unknown as Record<string, { message?: string } | undefined>)[
      key
    ]?.message;
  };

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      payout_account: { type: "mfs" },
    },
  });

  const selectRail = (type: "mfs" | "bank") => {
    setPayoutType(type);
    setValue("payout_account.type", type, {
      shouldValidate: false,
      shouldDirty: true,
    });
  };

  const onSubmit = (values: FormValues) => mutation.mutate(values);

  const submitError = mutation.isError
    ? isApiClientError(mutation.error)
      ? mutation.error.message
      : "We could not submit your application. Please try again."
    : null;

  if (mutation.isSuccess) {
    const { merchant_id } = mutation.data;
    return (
      <Shell>
        <div className="flex flex-col items-center gap-gate-12 text-center">
          <DrawnCheck />
          <h1 className="text-gate-h1 font-semibold text-gate-ink">
            Application received
          </h1>
          <p className="max-w-[44ch] text-gate-body-mobile text-gate-ink-2">
            We are reviewing your application. You will be able to create pay
            links and take payments as soon as it is approved. Keep an eye on
            your inbox.
          </p>
          <div className="mt-gate-8 rounded-gate-input border border-gate-border bg-gate-surface-2 px-gate-16 py-gate-12">
            <p className="text-gate-caption text-gate-ink-2">
              Your application reference
            </p>
            <p className="font-gate-mono text-gate-mono font-semibold tabular-nums text-gate-ink">
              {merchant_id}
            </p>
          </div>
          <p className="mt-gate-4 text-gate-caption text-gate-ink-2">
            Need a receipt? We emailed it to{" "}
            <span className="font-medium text-gate-ink">
              {mutation.variables?.email}
            </span>
            .
          </p>
          <LinkButtonHome className="mt-gate-16" />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto w-full max-w-[34rem]">
        <div className="mb-gate-24 text-center">
          <h1 className="text-gate-display font-semibold tracking-tight text-gate-ink">
            Start accepting wallet payments
          </h1>
          <p className="mx-auto mt-gate-8 max-w-[46ch] text-gate-body-mobile text-gate-ink-2">
            Tell us about your business. Every application is reviewed before
            you can take payments, so we ask for a payout account up front.
          </p>
        </div>

        <div className="rounded-gate-card border border-gate-border bg-gate-surface p-gate-20 md:p-gate-24">
          {submitError ? (
            <div className="mb-gate-20">
              <Banner variant="danger" title={submitError} />
            </div>
          ) : null}

          <form
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            noValidate
          >
            <Fieldset legend="Your business">
              <Input
                label="Business name"
                autoComplete="organization"
                placeholder="Acme Traders"
                error={errors.name?.message}
                {...register("name")}
              />
              <Input
                label="Business email"
                type="email"
                autoComplete="email"
                placeholder="mail@yourbusiness.com"
                error={errors.email?.message}
                {...register("email")}
              />
              <Input
                label="Mobile number"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="01XXXXXXXXX"
                hint="We use this for payment alerts and support."
                error={errors.phone?.message}
                {...register("phone")}
              />
              <Select
                label="Business type"
                placeholder="Select your business type"
                options={[...BUSINESS_TYPES]}
                error={errors.business_type?.message}
                {...register("business_type")}
              />
            </Fieldset>

            <Fieldset legend="Payout account">
              <p className="text-gate-caption text-gate-ink-2">
                Where should we send your settlement money?
              </p>

              <div
                role="radiogroup"
                aria-label="Payout account type"
                className="grid gap-gate-12 sm:grid-cols-2"
              >
                <RailCard
                  active={payoutType === "mfs"}
                  icon={<Smartphone className="size-4" aria-hidden="true" />}
                  title="Mobile wallet"
                  caption="bKash · Nagad · Rocket"
                  onSelect={() => selectRail("mfs")}
                />
                <RailCard
                  active={payoutType === "bank"}
                  icon={<Landmark className="size-4" aria-hidden="true" />}
                  title="Bank account"
                  caption="Any bank in Bangladesh"
                  onSelect={() => selectRail("bank")}
                />
              </div>

              {payoutType === "mfs" ? (
                <div className="grid gap-gate-12 sm:grid-cols-2">
                  <Select
                    label="Wallet provider"
                    placeholder="Select provider"
                    options={[...MFS_PROVIDERS]}
                    error={unionFieldError(errors.payout_account, "provider")}
                    {...register("payout_account.provider")}
                  />
                  <Input
                    label="Wallet number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="01XXXXXXXXX"
                    error={errors.payout_account?.account_no?.message}
                    {...register("payout_account.account_no")}
                  />
                  <Input
                    label="Account holder name"
                    autoComplete="off"
                    placeholder="As shown in the wallet app"
                    className="sm:col-span-2"
                    error={errors.payout_account?.holder?.message}
                    {...register("payout_account.holder")}
                  />
                </div>
              ) : (
                <div className="grid gap-gate-12 sm:grid-cols-2">
                  <Input
                    label="Bank name"
                    autoComplete="off"
                    placeholder="Islami Bank Bangladesh"
                    error={unionFieldError(errors.payout_account, "bank_name")}
                    {...register("payout_account.bank_name")}
                  />
                  <Input
                    label="Account number"
                    autoComplete="off"
                    inputMode="numeric"
                    placeholder="Account number"
                    error={errors.payout_account?.account_no?.message}
                    {...register("payout_account.account_no")}
                  />
                  <Input
                    label="Account holder name"
                    autoComplete="off"
                    placeholder="As shown on the account"
                    className="sm:col-span-2"
                    error={errors.payout_account?.holder?.message}
                    {...register("payout_account.holder")}
                  />
                </div>
              )}
            </Fieldset>

            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={isSubmitting || mutation.isPending}
              className="mt-gate-8"
            >
              Submit application
            </Button>

            <p className="mt-gate-12 text-center text-gate-caption text-gate-ink-2">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-gate-ink underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </Shell>
  );
}

function Fieldset({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mb-gate-24 flex flex-col gap-gate-16">
      <legend className="mb-gate-8 text-gate-h3 font-semibold text-gate-ink">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

function RailCard({
  active,
  icon,
  title,
  caption,
  onSelect,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  caption: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-gate-12 rounded-gate-input border p-gate-16 text-left",
        "transition-colors duration-[120ms] ease-gate",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-surface",
        active
          ? "border-gate-accent bg-gate-accent-soft"
          : "border-gate-border bg-gate-surface-2 hover:bg-gate-surface",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-gate-pill",
          active ? "bg-gate-accent-soft" : "bg-gate-surface",
        )}
      >
        <span
          className={cn(
            "inline-flex",
            active ? "text-gate-accent" : "text-gate-ink-2",
          )}
        >
          {icon}
        </span>
      </span>
      <span>
        <span className="block text-gate-body font-medium text-gate-ink">
          {title}
        </span>
        <span className="mt-gate-4 block text-gate-caption text-gate-ink-2">
          {caption}
        </span>
      </span>
    </button>
  );
}

function LinkButtonHome({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex h-12 items-center justify-center rounded-gate-button border border-gate-border bg-gate-surface px-gate-24 text-base font-medium text-gate-ink transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
        className,
      )}
    >
      Back to PayGate
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gate-bg text-gate-ink">
      <header className="mx-auto flex w-full max-w-[34rem] items-center justify-center px-gate-16 py-gate-20">
        <Link href="/" className="inline-flex items-center gap-gate-8">
          <span className="grid size-7 place-items-center rounded-gate-input bg-gate-ink text-gate-caption font-semibold text-gate-bg">
            P
          </span>
          <span className="text-gate-h3 font-semibold tracking-tight text-gate-ink">
            PayGate
          </span>
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-gate-16 pb-gate-48">
        {children}
      </main>
    </div>
  );
}