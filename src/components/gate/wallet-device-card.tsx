"use client";

import { Check, ListChecks, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type WalletProvider = "bkash" | "nagad" | "rocket";

export interface DevicePermission {
  label: string;
  granted: boolean;
}

export interface WalletDeviceCardProps {
  /** Device display name, e.g. `Pixel 7a (counter)`. */
  deviceName: string;
  provider: WalletProvider;
  /** Masked wallet number, e.g. `01••• •••789`. Already formatted. */
  msisdn: string;
  /** Heartbeat freshness. */
  online: boolean;
  /** Battery percentage 0-100. */
  battery: number;
  /** SMS queued on the device, not yet forwarded. */
  queueDepth: number;
  /** Limit used in the same unit as `limitTotal`. */
  limitUsed: number;
  /** Limit ceiling (paisa or count). */
  limitTotal: number;
  /** Preformatted "last heartbeat", e.g. `14s ago`. */
  lastHeartbeat: string;
  permissions: DevicePermission[];
  className?: string;
}

const PROVIDER_LABEL: Record<WalletProvider, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
};

const PROVIDER_DOT: Record<WalletProvider, string> = {
  bkash: "bg-gate-provider-bkash",
  nagad: "bg-gate-provider-nagad",
  rocket: "bg-gate-provider-rocket",
};

function BatteryRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const tone =
    clamped <= 20
      ? "text-gate-danger"
      : clamped <= 40
        ? "text-gate-warning"
        : "text-gate-success";

  return (
    <div
      className="relative inline-flex size-10 shrink-0 items-center justify-center"
      role="img"
      aria-label={`Battery ${clamped} percent`}
    >
      <svg viewBox="0 0 36 36" className="size-10 -rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="var(--gate-border)"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={tone}
        />
      </svg>
      <span className="absolute text-gate-caption font-medium tabular-nums text-gate-ink">
        {clamped}
      </span>
    </div>
  );
}

export function WalletDeviceCard({
  deviceName,
  provider,
  msisdn,
  online,
  battery,
  queueDepth,
  limitUsed,
  limitTotal,
  lastHeartbeat,
  permissions,
  className,
}: WalletDeviceCardProps) {
  const pct = limitTotal > 0 ? Math.min(100, Math.round((limitUsed / limitTotal) * 100)) : 0;
  const meterTone =
    pct >= 100
      ? "bg-gate-danger"
      : pct >= 80
        ? "bg-gate-warning"
        : "bg-gate-accent";

  return (
    <div
      className={cn(
        "flex flex-col gap-gate-16 rounded-gate-card border border-gate-border bg-gate-surface p-gate-20",
        className
      )}
    >
      <div className="flex items-start justify-between gap-gate-12">
        <div className="flex min-w-0 flex-col gap-gate-4">
          <div className="flex items-center gap-gate-8">
            <span
              className={cn("size-2.5 shrink-0 rounded-gate-pill", PROVIDER_DOT[provider])}
              aria-hidden="true"
            />
            <span className="truncate text-gate-body font-semibold text-gate-ink">
              {deviceName}
            </span>
          </div>
          <p className="font-gate-mono text-gate-mono whitespace-nowrap text-gate-ink-2">
            {msisdn}
          </p>
          <p className="text-gate-caption text-gate-ink-2">
            {PROVIDER_LABEL[provider]}
          </p>
        </div>
        <BatteryRing value={battery} />
      </div>

      <div className="flex flex-wrap items-center gap-x-gate-16 gap-y-gate-8">
        <span className="inline-flex items-center gap-gate-8 text-gate-caption font-medium text-gate-ink">
          <span className="relative inline-flex size-2.5" aria-hidden="true">
            {online ? (
              <span className="absolute inline-flex size-full animate-ping rounded-gate-pill bg-gate-success opacity-60 motion-reduce:animate-none" />
            ) : null}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-gate-pill",
                online ? "bg-gate-success" : "bg-gate-ink-3"
              )}
            />
          </span>
          {online ? "Live" : "Offline"}
        </span>

        <span className="text-gate-caption text-gate-ink-2">
          Last heartbeat {lastHeartbeat}
        </span>

        <span className="inline-flex items-center gap-gate-4 text-gate-caption text-gate-ink-2">
          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
          Queue {queueDepth}
        </span>
      </div>

      <div className="flex flex-col gap-gate-8">
        <div className="flex items-baseline justify-between gap-gate-8">
          <span className="text-gate-caption text-gate-ink-2">Daily limit used</span>
          <span className="text-gate-caption font-medium tabular-nums text-gate-ink">
            {pct}%
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-gate-pill bg-gate-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Daily limit used"
        >
          <div
            className={cn("h-full rounded-gate-pill", meterTone)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-wrap items-center gap-x-gate-16 gap-y-gate-8">
        {permissions.map((permission) => (
          <li
            key={permission.label}
            className="inline-flex items-center gap-gate-4 text-gate-caption text-gate-ink-2"
          >
            {permission.granted ? (
              <Check className="size-3.5 shrink-0 text-gate-success" aria-hidden="true" />
            ) : (
              <X className="size-3.5 shrink-0 text-gate-ink-3" aria-hidden="true" />
            )}
            {permission.label}
            <span className="sr-only">
              {permission.granted ? "granted" : "not granted"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
