"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { StatusChip, type PaymentStatus } from "@/components/gate";

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                           */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-gate-card border border-gate-border bg-gate-surface",
        className
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-gate-20", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-gate-12 border-b border-gate-border px-gate-20 py-gate-16",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-gate-4">
        <h2 className="text-gate-h3 font-semibold text-gate-ink">{title}</h2>
        {description ? (
          <p className="text-gate-caption text-gate-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-gate-8">{actions}</div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-gate-16",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-gate-4">
        <h1 className="text-gate-h1 font-semibold tracking-tight text-gate-ink">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[70ch] text-gate-body text-gate-ink-2">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-gate-8">{actions}</div>
      ) : null}
    </div>
  );
}

export function Toolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-gate-12 rounded-gate-card border border-gate-border bg-gate-surface p-gate-12",
        className
      )}
      {...props}
    />
  );
}

export function KeyValue({
  label,
  value,
  className,
  mono,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-gate-4", className)}>
      <dt className="text-gate-caption text-gate-ink-2">{label}</dt>
      <dd
        className={cn(
          "text-gate-body text-gate-ink",
          mono && "font-gate-mono text-gate-mono tabular-nums"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function Meter({
  value,
  max,
  label,
  className,
}: {
  /** Used amount (same unit as `max`). */
  value: number;
  max: number;
  label?: React.ReactNode;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone =
    pct >= 100
      ? "bg-gate-danger"
      : pct >= 80
        ? "bg-gate-warning"
        : "bg-gate-accent";

  return (
    <div className={cn("flex flex-col gap-gate-8", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-gate-8">
          <span className="text-gate-caption text-gate-ink-2">{label}</span>
          <span className="text-gate-caption font-medium tabular-nums text-gate-ink">
            {pct}%
          </span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-gate-pill bg-gate-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={typeof label === "string" ? label : "Usage"}
      >
        <div
          className={cn("h-full rounded-gate-pill", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                       */
/* -------------------------------------------------------------------------- */

export type PillTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";

const PILL_TONE: Record<PillTone, { tint: string; dot: string }> = {
  neutral: { tint: "bg-gate-surface-2", dot: "bg-gate-ink-3" },
  accent: { tint: "bg-gate-accent-soft", dot: "bg-gate-accent" },
  success: { tint: "bg-gate-success/10", dot: "bg-gate-success" },
  warning: { tint: "bg-gate-warning/10", dot: "bg-gate-warning" },
  danger: { tint: "bg-gate-danger/10", dot: "bg-gate-danger" },
};

/**
 * Non-payment status pill (wallet, device, payout, settlement, KYB, ...).
 * Status is never colour-alone: a dot + always-visible label ride along.
 */
export function StatusPill({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: PillTone;
  className?: string;
}) {
  const config = PILL_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-gate-8 rounded-gate-pill border border-gate-border/60 px-gate-8 py-gate-4 text-gate-caption font-medium text-gate-ink",
        config.tint,
        className
      )}
    >
      <span
        className={cn("size-2 shrink-0 rounded-gate-pill", config.dot)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

const GENERIC_TONE: Record<string, PillTone> = {
  active: "success",
  paid: "success",
  approved: "success",
  success: "success",
  live: "success",
  online: "success",
  pending: "warning",
  processing: "warning",
  awaiting_payment: "warning",
  requested: "warning",
  under_review: "warning",
  draining: "warning",
  paused: "warning",
  failed: "danger",
  rejected: "danger",
  revoked: "danger",
  disabled: "danger",
  suspended: "danger",
  expired: "neutral",
  cancelled: "neutral",
  archived: "neutral",
  offline: "neutral",
  created: "neutral",
};

const prettyLabel = (value: string) =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function GenericStatus({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  return (
    <StatusPill
      label={label ?? prettyLabel(status)}
      tone={GENERIC_TONE[status] ?? "neutral"}
      className={className}
    />
  );
}

const GATE_PAYMENT_STATUS: Record<string, PaymentStatus> = {
  created: "pending",
  awaiting_payment: "awaiting_payment",
  paid: "paid",
  expired: "expired",
  needs_review: "needs_review",
  failed: "failed",
};

/**
 * Payment status badge. Delegates to the Gate `StatusChip` for the shared
 * statuses and falls back to a labelled pill for `cancelled`.
 */
export function PaymentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  if (status === "cancelled") {
    return <StatusPill label="Cancelled" tone="neutral" className={className} />;
  }
  const mapped = GATE_PAYMENT_STATUS[status];
  if (!mapped) {
    return <GenericStatus status={status} className={className} />;
  }
  return <StatusChip status={mapped} className={className} />;
}

export function ProviderBadge({
  provider,
  label,
  className,
}: {
  provider: string;
  label: string;
  className?: string;
}) {
  const dot: Record<string, string> = {
    bkash: "bg-gate-provider-bkash",
    nagad: "bg-gate-provider-nagad",
    rocket: "bg-gate-provider-rocket",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-gate-8 text-gate-body text-gate-ink",
        className
      )}
    >
      <span
        className={cn(
          "size-2.5 shrink-0 rounded-gate-pill",
          dot[provider] ?? "bg-gate-ink-3"
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                         */
/* -------------------------------------------------------------------------- */

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    <button
      type="button"
      onClick={async () => {
        const { copyToClipboard } = await import("@/lib/utils");
        const ok = await copyToClipboard(value);
        if (!ok) return;
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-gate-input text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
        className
      )}
    >
      {copied ? (
        <CheckIcon className="size-4 text-gate-success" />
      ) : (
        <CopyIcon className="size-4" />
      )}
    </button>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
      <path d="M10.5 5.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m3 8.5 3.5 3.5L13 5" />
    </svg>
  );
}
