"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Override the built-in monoline illustration. */
  illustration?: React.ReactNode;
  /** A single action, usually a `<Button>`. */
  action?: React.ReactNode;
  className?: string;
}

/** Built-in monoline illustration: an empty wallet receiving a transfer. */
function WalletMonoline() {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-24 text-gate-ink-3"
    >
      <rect x="18" y="34" width="60" height="42" rx="10" />
      <path d="M18 48h60" />
      <path d="M66 48v4a4 4 0 0 0 4 4h8" />
      <circle cx="70" cy="50" r="2" />
      <path d="M30 62h16" />
      <path d="M30 68h10" />
      <path d="M24 22h30" strokeDasharray="4 5" />
      <path d="M54 16v12" />
      <path d="M50.5 19.5 54 16l3.5 3.5" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-gate-12 px-gate-24 py-gate-48 text-center",
        className
      )}
    >
      <div className="flex items-center justify-center" aria-hidden="true">
        {illustration ?? <WalletMonoline />}
      </div>

      <h3 className="text-gate-h3 font-semibold text-gate-ink">{title}</h3>

      {description ? (
        <p className="max-w-[46ch] text-gate-body text-gate-ink-2">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-gate-8">{action}</div> : null}
    </div>
  );
}
