"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual treatment. `primary` = ink fill, `danger` = tonal destructive. */
  variant?: ButtonVariant;
  /** `md` = 40px desktop / 48px mobile, `lg` = 48px at every breakpoint. */
  size?: ButtonSize;
  /** Show a spinner and block interaction while keeping the button width. */
  loading?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gate-ink text-gate-bg hover:bg-gate-ink/90",
  secondary:
    "border border-gate-border bg-gate-surface text-gate-ink hover:bg-gate-surface-2",
  ghost:
    "text-gate-ink-2 hover:bg-gate-surface-2 hover:text-gate-ink",
  // Tonal rather than a solid red fill: keeps the label at AA contrast
  // (#F04438 on white is only 3.8:1, so red stays on the border/tint, not the text).
  danger:
    "border border-gate-danger/40 bg-gate-danger/10 text-gate-ink hover:bg-gate-danger/15",
};

const SIZES: Record<ButtonSize, string> = {
  md: "h-12 px-gate-16 text-base md:h-10 md:text-sm",
  lg: "h-12 px-gate-24 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      className,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "relative inline-flex select-none items-center justify-center gap-gate-8 whitespace-nowrap rounded-gate-button font-medium",
          "transition-colors duration-[120ms] ease-gate active:translate-y-px",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-flex items-center gap-gate-8",
            loading && "invisible"
          )}
        >
          {children}
        </span>
        {loading ? (
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="sr-only">Loading</span>
          </span>
        ) : null}
      </button>
    );
  }
);
