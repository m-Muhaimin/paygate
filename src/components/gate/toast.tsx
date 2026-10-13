"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Info,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4000. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
  duration: number;
}

export interface ToastContextValue {
  /** Show a toast. Returns its id so it can be dismissed early. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION = 4000;

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

const VARIANT: Record<
  ToastVariant,
  { Icon: LucideIcon; ring: string; icon: string; live: "status" | "alert" }
> = {
  info: { Icon: Info, ring: "border-gate-border", icon: "text-gate-accent", live: "status" },
  success: { Icon: Check, ring: "border-gate-border", icon: "text-gate-success", live: "status" },
  warning: { Icon: AlertTriangle, ring: "border-gate-border", icon: "text-gate-warning", live: "alert" },
  danger: { Icon: X, ring: "border-gate-border", icon: "text-gate-danger", live: "alert" },
};

let toastCounter = 0;

export function ToastProvider({
  children,
  duration = DEFAULT_DURATION,
}: {
  children: React.ReactNode;
  /** Default auto-dismiss delay in ms for every toast. */
  duration?: number;
}) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      toastCounter += 1;
      const id = `gate-toast-${Date.now()}-${toastCounter}`;
      const record: ToastRecord = {
        ...options,
        id,
        duration: options.duration ?? duration,
      };

      setToasts((current) => [...current, record]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), record.duration)
      );
      return id;
    },
    [dismiss, duration]
  );

  React.useEffect(() => {
    const active = timers.current;
    return () => {
      active.forEach((timer) => clearTimeout(timer));
      active.clear();
    };
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-gate-8 p-gate-16 sm:items-end"
      >
        {toasts.map((item) => {
          const variant = item.variant ?? "info";
          const config = VARIANT[variant];
          const Icon = config.Icon;

          return (
            <div
              key={item.id}
              role={config.live}
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-gate-12 rounded-gate-card border bg-gate-surface p-gate-16",
                "shadow-[0_8px_24px_-12px_rgba(14,14,17,0.28)]",
                "animate-gate-toast-in motion-reduce:animate-none",
                config.ring
              )}
            >
              <Icon
                className={cn("mt-0.5 size-4 shrink-0", config.icon)}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-gate-4">
                <p className="text-gate-body font-medium text-gate-ink">{item.title}</p>
                {item.description ? (
                  <p className="text-gate-caption text-gate-ink-2">
                    {item.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="-m-gate-8 inline-flex size-11 shrink-0 items-center justify-center rounded-gate-input text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
