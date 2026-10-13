"use client";

import {
  AlertTriangle,
  Check,
  CircleDashed,
  CircleSlash,
  Clock,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Payment statuses from SPEC v3 section 3. */
export type PaymentStatus =
  | "pending"
  | "awaiting_payment"
  | "paid"
  | "expired"
  | "needs_review"
  | "failed";

export interface StatusChipProps {
  status: PaymentStatus;
  /** Show only the shape/colour cue plus an icon (label goes to screen readers). */
  compact?: boolean;
  className?: string;
}

interface StatusConfig {
  label: string;
  dot: string;
  tint: string;
  Icon: LucideIcon;
}

/**
 * Status is never colour-alone: every status pairs a distinct icon shape,
 * a label, and a semantic tint.
 */
const CONFIG: Record<PaymentStatus, StatusConfig> = {
  pending: {
    label: "Pending",
    dot: "bg-gate-ink-3",
    tint: "bg-gate-surface-2",
    Icon: CircleDashed,
  },
  awaiting_payment: {
    label: "Awaiting payment",
    dot: "bg-gate-warning",
    tint: "bg-gate-warning/10",
    Icon: Clock,
  },
  paid: {
    label: "Paid",
    dot: "bg-gate-success",
    tint: "bg-gate-success/10",
    Icon: Check,
  },
  expired: {
    label: "Expired",
    dot: "bg-gate-ink-3",
    tint: "bg-gate-surface-2",
    Icon: CircleSlash,
  },
  needs_review: {
    label: "Needs review",
    dot: "bg-gate-warning",
    tint: "bg-gate-warning/10",
    Icon: AlertTriangle,
  },
  failed: {
    label: "Failed",
    dot: "bg-gate-danger",
    tint: "bg-gate-danger/10",
    Icon: X,
  },
};

export function StatusChip({ status, compact = false, className }: StatusChipProps) {
  const { label, dot, tint, Icon } = CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-gate-8 rounded-gate-pill border border-gate-border/60 px-gate-8 py-gate-4",
        "text-gate-caption font-medium text-gate-ink",
        tint,
        className
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-gate-pill", dot)} aria-hidden="true" />
      <Icon className="size-3.5 shrink-0 text-gate-ink-2" aria-hidden="true" />
      <span className={cn(compact && "sr-only")}>{label}</span>
    </span>
  );
}
