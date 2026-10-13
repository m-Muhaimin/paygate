"use client";

import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-gate-input bg-gate-surface-2 motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-gate-16 sm:grid-cols-2 xl:grid-cols-4"
      role="status"
      aria-label="Loading statistics"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-gate-12 rounded-gate-card border border-gate-border bg-gate-surface p-gate-20"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-16 rounded-gate-pill" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-gate-card border border-gate-border bg-gate-surface"
      role="status"
      aria-label="Loading table"
    >
      <div className="flex gap-gate-16 border-b border-gate-border px-gate-16 py-gate-12">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="flex flex-col">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex items-center gap-gate-16 border-b border-gate-border px-gate-16 py-gate-14 last:border-b-0"
          >
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton
                key={colIndex}
                className={cn("h-4 flex-1", colIndex === 0 && "max-w-32")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 gap-gate-16 md:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label="Loading devices"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-gate-16 rounded-gate-card border border-gate-border bg-gate-surface p-gate-20"
        >
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-gate-8">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="size-10 rounded-gate-pill" />
          </div>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-2 w-full rounded-gate-pill" />
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
    </div>
  );
}

export function LinesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-gate-12" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}
