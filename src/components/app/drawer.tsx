"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Panel max width class. Defaults to `max-w-xl`. */
  widthClassName?: string;
}

/** Right-side sheet. Mounts only while open; Esc + backdrop close. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClassName = "max-w-xl",
}: DrawerProps) {
  if (!open) return null;
  return (
    <DrawerPanel
      onClose={onClose}
      title={title}
      description={description}
      footer={footer}
      widthClassName={widthClassName}
    >
      {children}
    </DrawerPanel>
  );
}

function DrawerPanel({
  onClose,
  title,
  description,
  children,
  footer,
  widthClassName,
}: Omit<DrawerProps, "open"> & { widthClassName: string }) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    const panel = panelRef.current;
    const previousFocus = document.activeElement;
    panel?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" aria-hidden={false}>
      <button
        type="button"
        aria-label="Close panel"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 cursor-default bg-gate-ink/40 transition-opacity duration-[320ms] ease-gate motion-reduce:transition-none",
          entered ? "opacity-100" : "opacity-0"
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-drawer-title"
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-gate-border bg-gate-surface",
          "transition-transform duration-[320ms] ease-gate motion-reduce:transition-none",
          "focus-visible:outline-none",
          widthClassName,
          entered ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-start justify-between gap-gate-16 border-b border-gate-border px-gate-20 py-gate-16">
          <div className="flex min-w-0 flex-col gap-gate-4">
            <h2
              id="gate-drawer-title"
              className="text-gate-h3 font-semibold text-gate-ink"
            >
              {title}
            </h2>
            {description ? (
              <div className="text-gate-caption text-gate-ink-2">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-m-gate-8 inline-flex size-11 shrink-0 items-center justify-center rounded-gate-input text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-gate-20 py-gate-20">
          {children}
        </div>

        {footer ? (
          <div className="border-t border-gate-border px-gate-20 py-gate-16">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
