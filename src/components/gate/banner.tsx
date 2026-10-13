"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type BannerVariant = "info" | "success" | "warning" | "danger";

export interface BannerProps {
  variant?: BannerVariant;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Trailing action, usually a small Button. */
  action?: React.ReactNode;
  /** When provided, renders a dismiss button. */
  onDismiss?: () => void;
  className?: string;
}

const VARIANT: Record<
  BannerVariant,
  { Icon: LucideIcon; tint: string; icon: string; live: "status" | "alert" }
> = {
  info: { Icon: Info, tint: "bg-gate-accent-soft", icon: "text-gate-accent", live: "status" },
  success: { Icon: Check, tint: "bg-gate-success/10", icon: "text-gate-success", live: "status" },
  warning: { Icon: AlertTriangle, tint: "bg-gate-warning/10", icon: "text-gate-warning", live: "alert" },
  danger: { Icon: X, tint: "bg-gate-danger/10", icon: "text-gate-danger", live: "alert" },
};

export function Banner({
  variant = "info",
  title,
  description,
  action,
  onDismiss,
  className,
}: BannerProps) {
  const config = VARIANT[variant];
  const Icon = config.Icon;

  return (
    <div
      role={config.live}
      className={cn(
        "flex items-start gap-gate-12 rounded-gate-card border border-gate-border p-gate-16",
        config.tint,
        className
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", config.icon)}
        aria-hidden="true"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-gate-4">
        <p className="text-gate-body font-medium text-gate-ink">{title}</p>
        {description ? (
          <p className="text-gate-body text-gate-ink-2">{description}</p>
        ) : null}
        {action ? <div className="mt-gate-4">{action}</div> : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-gate-8 inline-flex size-11 shrink-0 items-center justify-center rounded-gate-input text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
