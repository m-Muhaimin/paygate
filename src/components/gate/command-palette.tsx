"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  /** Additional search terms that should match this item. */
  keywords?: string[];
  /** Optional grouping label. Groups keep their first-seen order. */
  group?: string;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Right-aligned hint, e.g. a route or shortcut. Rendered in mono. */
  hint?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  items: CommandItem[];
  /** Controlled open state. Omit for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Wire the built-in Cmd/Ctrl+K shortcut. Defaults to true. */
  enableShortcut?: boolean;
  className?: string;
}

/**
 * Subsequence fuzzy match. Returns -1 when the query does not match.
 * Contiguous runs and word starts score higher.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  const direct = t.indexOf(q);
  if (direct !== -1) return 1000 - direct;

  let score = 0;
  let cursor = 0;
  let streak = 0;

  for (let i = 0; i < q.length; i += 1) {
    const found = t.indexOf(q[i], cursor);
    if (found === -1) return -1;
    streak = found === cursor ? streak + 1 : 0;
    score += 1 + streak * 2;
    if (found === 0 || t[found - 1] === " ") score += 3;
    cursor = found + 1;
  }

  return score;
}

export function CommandPalette({
  items,
  open,
  onOpenChange,
  placeholder = "Search commands...",
  emptyMessage = "No matching commands.",
  enableShortcut = true,
  className,
}: CommandPaletteProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = isControlled ? open : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  // Global Cmd/Ctrl+K shortcut.
  React.useEffect(() => {
    if (!enableShortcut) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!isOpen);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcut, isOpen, setOpen]);

  if (!isOpen) return null;

  return (
    <PalettePanel
      items={items}
      onClose={() => setOpen(false)}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      className={className}
    />
  );
}

interface PalettePanelProps {
  items: CommandItem[];
  onClose: () => void;
  placeholder: string;
  emptyMessage: string;
  className?: string;
}

/**
 * Mounted only while the palette is open, so query/activeIndex reset naturally
 * on close without a state-resetting effect.
 */
function PalettePanel({
  items,
  onClose,
  placeholder,
  emptyMessage,
  className,
}: PalettePanelProps) {
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previousFocus = React.useRef<Element | null>(null);

  // Focus on open, restore on close, lock body scroll. DOM-only, no setState.
  React.useEffect(() => {
    previousFocus.current = document.activeElement;
    inputRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      const element = previousFocus.current;
      if (element instanceof HTMLElement) element.focus();
    };
  }, []);

  const results = React.useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return items;

    return items
      .map((item) => {
        const haystacks = [item.label, ...(item.keywords ?? [])];
        const best = haystacks.reduce(
          (max, text) => Math.max(max, fuzzyScore(trimmed, text)),
          -1
        );
        return { item, score: best };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [items, query]);

  const groups = React.useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, CommandItem[]>();
    for (const item of results) {
      const key = item.group ?? "";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(item);
    }
    return order.map((key) => ({ key, items: map.get(key)! }));
  }, [results]);

  const active = results[activeIndex];
  const activeId = active ? `${baseId}-option-${active.id}` : undefined;

  const select = (item: CommandItem) => {
    onClose();
    item.onSelect();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length ? (index + 1) % results.length : 0
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length ? (index - 1 + results.length) % results.length : 0
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active) select(active);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  let optionIndex = -1;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center p-gate-16 pt-[12vh]",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-gate-ink/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-gate-card border border-gate-border bg-gate-surface shadow-[0_24px_60px_-24px_rgba(14,14,17,0.5)]"
      >
        <div className="flex items-center gap-gate-8 border-b border-gate-border px-gate-16">
          <Search className="size-4 shrink-0 text-gate-ink-3" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={placeholder}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-gate-body text-gate-ink outline-none placeholder:text-gate-ink-3"
          />
        </div>

        <div
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto p-gate-8"
        >
          {results.length === 0 ? (
            <p className="px-gate-12 py-gate-24 text-center text-gate-body text-gate-ink-2">
              {emptyMessage}
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.key || "ungrouped"}
                role="group"
                aria-label={group.key || undefined}
              >
                {group.key ? (
                  <p className="px-gate-12 pb-gate-4 pt-gate-8 text-gate-caption font-medium text-gate-ink-3">
                    {group.key}
                  </p>
                ) : null}
                {group.items.map((item) => {
                  optionIndex += 1;
                  const index = optionIndex;
                  const selected = index === activeIndex;
                  return (
                    <div
                      key={item.id}
                      id={`${baseId}-option-${item.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => select(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-gate-12 rounded-gate-input px-gate-12 py-gate-8 text-gate-body text-gate-ink",
                        selected && "bg-gate-surface-2"
                      )}
                    >
                      {item.icon ? (
                        <span className="shrink-0 text-gate-ink-2" aria-hidden="true">
                          {item.icon}
                        </span>
                      ) : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint ? (
                        <span className="shrink-0 font-gate-mono text-gate-caption text-gate-ink-3">
                          {item.hint}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
