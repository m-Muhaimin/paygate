"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Rendered above the control as a real `<label>`. */
  label?: React.ReactNode;
  /** Error message. Drives `aria-invalid` and the inline message. */
  error?: string;
  /** Helper text shown when there is no error. */
  hint?: string;
  /** Extra classes for the field wrapper (not the input itself). */
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { label, error, hint, id, className, containerClassName, disabled, ...props },
    ref
  ) {
    const generatedId = React.useId();
    const inputId = id ?? `gate-input-${generatedId}`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("flex w-full flex-col gap-gate-8", containerClassName)}>
        {label ? (
          <label
            htmlFor={inputId}
            className="text-gate-body font-medium text-gate-ink"
          >
            {label}
          </label>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full rounded-gate-input border bg-gate-surface-2 px-gate-12 text-base text-gate-ink md:text-sm",
            "placeholder:text-gate-ink-3",
            "transition-colors duration-[120ms] ease-gate",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-0",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-gate-danger" : "border-gate-border",
            className
          )}
          {...props}
        />

        {error ? (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-gate-4 text-gate-caption text-gate-ink"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-gate-danger"
              aria-hidden="true"
            />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p id={hintId} className="text-gate-caption text-gate-ink-2">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
