"use client";

import dynamic from "next/dynamic";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const Sparkline = dynamic(() => import("./sparkline"), {
  ssr: false,
  loading: () => <div className="h-10 w-full" />,
});

export type DeltaDirection = "up" | "down" | "flat";
export type SparklineColor = "accent" | "success" | "danger" | "warning";

export interface StatCardDelta {
  /** Preformatted, e.g. `+12.4%` or `-Tk 4,200`. */
  value: string;
  direction: DeltaDirection;
}

export interface StatCardProps {
  /** Small uppercase-free caption, e.g. `Paid this week`. */
  caption: string;
  /** Preformatted display value, e.g. `Tk 128,400`. */
  value: string;
  /** Optional delta chip. */
  delta?: StatCardDelta;
  /** Optional trend series rendered as a sparkline. */
  sparkline?: number[];
  sparklineColor?: SparklineColor;
  className?: string;
}

const DELTA: Record<
  DeltaDirection,
  { Icon: LucideIcon; tint: string; icon: string; word: string }
> = {
  up: {
    Icon: TrendingUp,
    tint: "bg-gate-success/10",
    icon: "text-gate-success",
    word: "Increase",
  },
  down: {
    Icon: TrendingDown,
    tint: "bg-gate-danger/10",
    icon: "text-gate-danger",
    word: "Decrease",
  },
  flat: {
    Icon: Minus,
    tint: "bg-gate-surface-2",
    icon: "text-gate-ink-3",
    word: "No change",
  },
};

const SPARKLE: Record<SparklineColor, string> = {
  accent: "var(--gate-accent)",
  success: "var(--gate-success)",
  danger: "var(--gate-danger)",
  warning: "var(--gate-warning)",
};

export function StatCard({
  caption,
  value,
  delta,
  sparkline,
  sparklineColor = "accent",
  className,
}: StatCardProps) {
  const deltaCfg = delta ? DELTA[delta.direction] : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-gate-12 rounded-gate-card border border-gate-border bg-gate-surface p-gate-20",
        className
      )}
    >
      <p className="text-gate-caption font-medium text-gate-ink-2">{caption}</p>

      <p className="font-gate-ui text-gate-display font-semibold tabular-nums leading-none text-gate-ink">
        {value}
      </p>

      {delta && deltaCfg ? (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-gate-4 rounded-gate-pill px-gate-8 py-gate-4 text-gate-caption font-medium text-gate-ink",
            deltaCfg.tint
          )}
        >
          <deltaCfg.Icon
            className={cn("size-3.5 shrink-0", deltaCfg.icon)}
            aria-hidden="true"
          />
          <span className="sr-only">{deltaCfg.word}</span>
          <span>{delta.value}</span>
        </span>
      ) : null}

      {sparkline && sparkline.length > 1 ? (
        <div className="mt-gate-4">
          <Sparkline data={sparkline} color={SPARKLE[sparklineColor]} />
        </div>
      ) : null}
    </div>
  );
}
