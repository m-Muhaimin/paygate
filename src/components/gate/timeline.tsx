"use client";

import {
  Check,
  CircleDashed,
  CircleDot,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type TimelineStatus = "done" | "current" | "upcoming" | "error";

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  /** Preformatted timestamp, e.g. `13 Oct 2026, 14:02`. */
  timestamp: string;
  status?: TimelineStatus;
  /** Overrides the default status icon. */
  icon?: React.ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const MARKER: Record<
  TimelineStatus,
  { Icon: LucideIcon; wrap: string; icon: string; word: string }
> = {
  done: {
    Icon: Check,
    wrap: "bg-gate-success/12 text-gate-success",
    icon: "text-gate-success",
    word: "Completed",
  },
  current: {
    Icon: CircleDot,
    wrap: "bg-gate-accent-soft",
    icon: "text-gate-accent",
    word: "In progress",
  },
  upcoming: {
    Icon: CircleDashed,
    wrap: "bg-gate-surface-2",
    icon: "text-gate-ink-3",
    word: "Upcoming",
  },
  error: {
    Icon: X,
    wrap: "bg-gate-danger/12",
    icon: "text-gate-danger",
    word: "Failed",
  },
};

export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const status = item.status ?? "upcoming";
        const config = MARKER[status];
        const Icon = config.Icon;
        const isLast = index === items.length - 1;

        return (
          <li key={item.id} className="grid grid-cols-[auto_1fr] gap-x-gate-12">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-gate-pill",
                  config.wrap
                )}
              >
                {item.icon ?? <Icon className={cn("size-3.5", config.icon)} />}
              </span>
              {!isLast ? (
                <span className="my-gate-4 w-px flex-1 bg-gate-border" />
              ) : null}
            </div>

            <div className={cn("min-w-0", !isLast && "pb-gate-20")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-gate-12 gap-y-gate-4">
                <p className="text-gate-body font-medium text-gate-ink">
                  {item.title}
                </p>
                <time className="text-gate-caption text-gate-ink-2">
                  {item.timestamp}
                </time>
              </div>
              <span className="sr-only">{config.word}</span>
              {item.description ? (
                <p className="mt-gate-4 text-gate-body text-gate-ink-2">
                  {item.description}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
