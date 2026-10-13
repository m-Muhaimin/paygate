"use client";

import * as React from "react";

import { Banner, Button, EmptyState } from "@/components/gate";
import { errorMessage } from "@/lib/client/query";

/** Inline error surface with an optional retry. */
export function ErrorState({
  error,
  onRetry,
  title = "Could not load this data",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <Banner
      variant="danger"
      title={title}
      className={className}
      description={
        <span className="flex flex-col gap-gate-8">
          <span>{errorMessage(error)}</span>
          {onRetry ? (
            <Button
              variant="secondary"
              className="w-fit"
              onClick={onRetry}
              type="button"
            >
              Try again
            </Button>
          ) : null}
        </span>
      }
    />
  );
}

/** Empty-state node sized for a `DataTable` body. */
export function TableEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <EmptyState title={title} description={description} action={action} />;
}

/**
 * Render an async list region: loading / error / empty / content.
 * Keeps the three states consistent across every screen.
 */
export function ListRegion({
  isPending,
  isError,
  error,
  onRetry,
  isEmpty,
  skeleton,
  empty,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry?: () => void;
  isEmpty: boolean;
  skeleton: React.ReactNode;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  if (isPending) return <>{skeleton}</>;
  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
