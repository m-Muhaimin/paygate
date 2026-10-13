import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";

export type LinkButtonVariant = "primary" | "secondary" | "ghost";
export type LinkButtonSize = "md" | "lg";

export interface LinkButtonProps
  extends Omit<React.ComponentProps<typeof Link>, "className"> {
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Navigation counterpart to the Gate `Button` primitive. Keeps `<Link>` / `<a>`
 * semantics (new tab, right-click, crawlable) while reusing the exact Gate
 * button visuals. Gate's `Button` renders a `<button>`, which cannot navigate.
 */
const VARIANTS: Record<LinkButtonVariant, string> = {
  primary: "bg-gate-ink text-gate-bg hover:bg-gate-ink/90",
  secondary:
    "border border-gate-border bg-gate-surface text-gate-ink hover:bg-gate-surface-2",
  ghost: "text-gate-ink-2 hover:bg-gate-surface-2 hover:text-gate-ink",
};

const SIZES: Record<LinkButtonSize, string> = {
  md: "h-12 px-gate-16 text-base md:h-10 md:text-sm",
  lg: "h-12 px-gate-24 text-base",
};

export function LinkButton({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      className={cn(
        "relative inline-flex select-none items-center justify-center gap-gate-8 whitespace-nowrap rounded-gate-button font-medium",
        "transition-colors duration-[120ms] ease-gate active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
