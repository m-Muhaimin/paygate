"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Select                                                                       */
/* -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  options: SelectOption[];
  containerClassName?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    { label, hint, error, options, id, className, containerClassName, ...props },
    ref
  ) {
    const generatedId = React.useId();
    const selectId = id ?? `gate-select-${generatedId}`;
    const describedBy =
      [error ? `${selectId}-error` : null, hint ? `${selectId}-hint` : null]
        .filter(Boolean)
        .join(" ") || undefined;

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
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full appearance-none rounded-gate-input border bg-gate-surface-2 bg-[length:16px] bg-[right_12px_center] bg-no-repeat px-gate-12 pr-gate-32 text-base text-gate-ink md:text-sm",
            "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%238A8A94%22 stroke-width=%221.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m4 6 4 4 4-4%22/></svg>')]",
            "transition-colors duration-[120ms] ease-gate",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-gate-danger" : "border-gate-border",
            className
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        {error ? (
          <p
            id={`${selectId}-error`}
            role="alert"
            className="text-gate-caption text-gate-ink"
          >
            {error}
          </p>
        ) : hint ? (
          <p id={`${selectId}-hint`} className="text-gate-caption text-gate-ink-2">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Textarea                                                                     */
/* -------------------------------------------------------------------------- */

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, id, className, containerClassName, ...props },
    ref
  ) {
    const generatedId = React.useId();
    const fieldId = id ?? `gate-textarea-${generatedId}`;
    const describedBy =
      [error ? `${fieldId}-error` : null, hint ? `${fieldId}-hint` : null]
        .filter(Boolean)
        .join(" ") || undefined;

    return (
      <div className={cn("flex w-full flex-col gap-gate-8", containerClassName)}>
        {label ? (
          <label
            htmlFor={fieldId}
            className="text-gate-body font-medium text-gate-ink"
          >
            {label}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-24 w-full rounded-gate-input border bg-gate-surface-2 px-gate-12 py-gate-8 text-base text-gate-ink md:text-sm",
            "placeholder:text-gate-ink-3",
            "transition-colors duration-[120ms] ease-gate",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-gate-danger" : "border-gate-border",
            className
          )}
          {...props}
        />
        {error ? (
          <p
            id={`${fieldId}-error`}
            role="alert"
            className="text-gate-caption text-gate-ink"
          >
            {error}
          </p>
        ) : hint ? (
          <p id={`${fieldId}-hint`} className="text-gate-caption text-gate-ink-2">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);

/* -------------------------------------------------------------------------- */
/* Switch                                                                       */
/* -------------------------------------------------------------------------- */

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  id,
  className,
}: SwitchProps) {
  const generatedId = React.useId();
  const fieldId = id ?? `gate-switch-${generatedId}`;
  const descriptionId = `${fieldId}-description`;

  return (
    <div className={cn("flex items-start justify-between gap-gate-12", className)}>
      <div className="flex flex-col gap-gate-2">
        <label
          htmlFor={fieldId}
          className={cn(
            "text-gate-body font-medium text-gate-ink",
            disabled && "opacity-50"
          )}
        >
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-gate-caption text-gate-ink-2">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        id={fieldId}
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-gate-pill border transition-colors duration-[120ms] ease-gate",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent focus-visible:ring-offset-2 focus-visible:ring-offset-gate-bg",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "border-gate-accent bg-gate-accent"
            : "border-gate-border bg-gate-surface-2"
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-gate-pill bg-gate-surface shadow-sm transition-transform duration-[120ms] ease-gate",
            checked ? "translate-x-6" : "translate-x-1"
          )}
          aria-hidden="true"
        />
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}
