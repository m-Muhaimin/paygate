"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { cn, copyToClipboard } from "@/lib/utils";

export interface ReferenceChipProps {
  /** The 8-character payment reference (or any short key). Never truncated. */
  reference: string;
  /** Accessible label used in the copy button. */
  label?: string;
  /** `md` = 44px touch target (default), `sm` = 36px for dense tables. */
  size?: "md" | "sm";
  className?: string;
}

export function ReferenceChip({
  reference,
  label = "Reference",
  size = "md",
  className,
}: ReferenceChipProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const handleCopy = async () => {
    const ok = await copyToClipboard(reference);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-gate-input bg-gate-accent-soft pl-gate-12",
        size === "md" ? "min-h-11" : "min-h-9",
        className
      )}
    >
      <span className="font-gate-mono text-gate-mono font-medium whitespace-nowrap text-gate-accent">
        {reference}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? `${label} copied` : `Copy ${label} ${reference}`}
        className={cn(
          "ml-gate-4 inline-flex shrink-0 items-center justify-center rounded-gate-input text-gate-accent",
          "transition-colors duration-[120ms] ease-gate hover:bg-gate-accent/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
          size === "md" ? "size-11" : "size-9"
        )}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
