"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  /** Stable key, also used as the React key for the cell. */
  key: string;
  header: React.ReactNode;
  /** Custom cell renderer. Falls back to `row[key]` when omitted. */
  render?: (row: T) => React.ReactNode;
  /** Render with JetBrains Mono + tabular figures (ids, refs, amounts). */
  mono?: boolean;
  align?: "left" | "right" | "center";
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable id per row. */
  getRowId: (row: T) => string;
  /** When provided, rows become keyboard-operable and open a right drawer. */
  onRowClick?: (row: T) => void;
  /** Accessible table caption (visually hidden). */
  caption?: string;
  /** Rendered in place of the body when `rows` is empty. */
  emptyState?: React.ReactNode;
  /** Row height in px. Defaults to 48. */
  rowHeight?: number;
  className?: string;
}

const ALIGN: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  caption,
  emptyState,
  rowHeight = 48,
  className,
}: DataTableProps<T>) {
  const clickable = Boolean(onRowClick);

  return (
    <div
      className={cn(
        "w-full overflow-auto rounded-gate-card border border-gate-border bg-gate-surface",
        className
      )}
    >
      <table className="w-full border-collapse text-gate-body">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "sticky top-0 z-10 h-11 whitespace-nowrap border-b border-gate-border bg-gate-surface px-gate-16 text-gate-caption font-medium text-gate-ink-2",
                  ALIGN[column.align ?? "left"],
                  column.headerClassName
                )}
              >
                {column.header}
              </th>
            ))}
            {clickable ? (
              <th scope="col" className="sticky top-0 z-10 w-10 border-b border-gate-border bg-gate-surface">
                <span className="sr-only">Open</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (clickable ? 1 : 0)}
                className="px-gate-16 py-gate-32"
              >
                {emptyState ?? (
                  <p className="text-center text-gate-body text-gate-ink-2">
                    Nothing to show yet.
                  </p>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = getRowId(row);
              return (
                <tr
                  key={id}
                  style={{ height: rowHeight }}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `Open ${id}` : undefined}
                  onClick={clickable ? () => onRowClick?.(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick?.(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "border-b border-gate-border last:border-b-0",
                    clickable &&
                      "cursor-pointer transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gate-accent"
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "whitespace-nowrap px-gate-16 align-middle text-gate-ink",
                        ALIGN[column.align ?? "left"],
                        column.mono && "font-gate-mono text-gate-mono tabular-nums",
                        column.cellClassName
                      )}
                    >
                      {column.render
                        ? column.render(row)
                        : ((row as Record<string, React.ReactNode>)[column.key] ?? null)}
                    </td>
                  ))}
                  {clickable ? (
                    <td className="pr-gate-12 align-middle">
                      <ChevronRight
                        className="size-4 text-gate-ink-3"
                        aria-hidden="true"
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
