"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

const STORAGE_KEY = "paygate-theme";

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

/** Class-based dark-mode toggle (`.dark` on `<html>`), persisted to storage. */
export function ThemeToggle({ className }: { className?: string }) {
  // Reads the theme the layout bootstrap already applied before hydration.
  const [dark, setDark] = React.useState<boolean>(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.classList.contains("dark")
  );

  const toggle = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // storage unavailable (private mode) — class still applied for the session
    }
  };

  const isDark = dark;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-gate-input text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
        className
      )}
    >
      {isDark ? (
        <Moon className="size-4" aria-hidden="true" />
      ) : (
        <Sun className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
