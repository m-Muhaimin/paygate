"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn, copyToClipboard } from "@/lib/utils";

export interface CopyButtonProps {
  /** Text placed on the clipboard. */
  value: string;
  /** Accessible name for the button, e.g. "Copy wallet number 017...". */
  label: string;
  /** Announced (and shown) for a moment after a successful copy. */
  copiedLabel: string;
  className?: string;
}

/**
 * Neutral 44px copy button. Unlike `ReferenceChip` it carries no accent tint,
 * so it can sit beside the wallet number without competing with the reference
 * chip (the single accented element on the waiting screen).
 */
export function CopyButton({ value, label, copiedLabel, className }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-gate-input border border-gate-border bg-gate-surface text-gate-ink-2",
          "transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
          className,
        )}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
