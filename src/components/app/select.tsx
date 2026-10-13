"use client";

import { AlertCircle, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  options: SelectOption[];
  /** Shown as a disabled first option when the value is empty. */
  placeholder?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

/**
 * Native `<select>` styled to the Gate field tokens. Gate ships `Input` but no
 * select primitive, so this keeps the same label / helper / error anatomy.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      options,
      placeholder,
      error,
      hint,
      id,
      className,
      containerClassName,
      disabled,
      ...props
    },
    ref,
  ) {
    const generatedId = React.useId();
    const selectId = id ?? `gate-select-${generatedId}`;
    const errorId = `${selectId}-error`;
    const hintId = `${selectId}-hint`;
    const describedBy =
      [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
      undefined;

    return (
      <div className={cn("flex w-full flex-col gap-gate-8", containerClassName)}>
        {label ? (
          <label
            htmlFor={selectId}
            className="text-gate-body font-medium text-gate-ink"
          >
            {label}
          </label>
        ) : null}

        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              "h-11 w-full appearance-none rounded-gate-input border bg-gate-surface-2 px-gate-12 pr-gate-36 text-base text-gate-ink md:text-sm",
              "transition-colors duration-[120ms] ease-gate",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-0",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error ? "border-gate-danger" : "border-gate-border",
              className,
            )}
            {...props}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-gate-12 top-1/2 size-4 -translate-y-1/2 text-gate-ink-2"
            aria-hidden="true"
          />
        </div>

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
  },
);
