"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Search } from "lucide-react";

import { CommandPalette, type CommandItem } from "@/components/gate";
import { getPayments, queryKeys } from "@/lib/client/query";
import { cn } from "@/lib/utils";

import { ThemeToggle } from "./theme-toggle";
import {
  activeItem,
  activeSection,
  otherSection,
  pageTitle,
  SECTIONS,
} from "./nav";
import { formatBdt } from "./format";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const section = activeSection(pathname);
  const other = otherSection(pathname);
  const title = pageTitle(pathname);
  const current = activeItem(pathname);

  const jumps = useQuery({
    queryKey: queryKeys.payments({ limit: 20 }),
    queryFn: () => getPayments({ limit: 20 }),
    staleTime: 60_000,
    retry: false,
  });

  const commandItems = React.useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = SECTIONS.flatMap((navSection) =>
      navSection.items.map((item) => ({
        id: `nav-${item.href}`,
        label: `${navSection.shortLabel}: ${item.label}`,
        keywords: ["go", "open", item.href, navSection.id],
        group: "Navigate",
        icon: <item.icon className="size-4" />,
        hint: item.href,
        onSelect: () => router.push(item.href),
      }))
    );

    const paymentItems: CommandItem[] = (jumps.data ?? [])
      .slice(0, 20)
      .map((payment) => ({
        id: `payment-${payment.id}`,
        label: `${payment.reference} · ${payment.order_id ?? payment.id}`,
        keywords: [
          payment.reference,
          payment.id,
          payment.order_id ?? "",
          payment.submitted_trx_id ?? "",
          payment.provider,
        ].filter(Boolean) as string[],
        group: "Payments",
        hint: formatBdt(payment.amount),
        onSelect: () => router.push(`/payments?id=${payment.id}`),
      }));

    const shortcuts: CommandItem[] = [
      {
        id: "switch-section",
        label:
          other.id === "admin"
            ? "Open the admin console"
            : "Back to the merchant dashboard",
        keywords: ["switch", "admin", "merchant", "console"],
        group: "Navigate",
        icon: <ArrowLeftRight className="size-4" />,
        onSelect: () => router.push(other.items[0].href),
      },
    ];

    return [...navItems, ...shortcuts, ...paymentItems];
  }, [jumps.data, other, router]);

  return (
    <div className="min-h-screen bg-gate-bg">
      <a
        href="#gate-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-gate-16 focus:top-gate-16 focus:z-50 focus:rounded-gate-input focus:bg-gate-ink focus:px-gate-16 focus:py-gate-8 focus:text-gate-body focus:text-gate-bg"
      >
        Skip to content
      </a>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <Sidebar pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-gate-12 border-b border-gate-border bg-gate-bg/85 px-gate-16 backdrop-blur lg:px-gate-24">
            <Link
              href={section.items[0].href}
              className="flex items-center gap-gate-8 md:hidden"
              aria-label="PayGate"
            >
              <span className="flex size-7 items-center justify-center rounded-gate-input bg-gate-ink text-gate-caption font-bold text-gate-bg">
                P
              </span>
            </Link>

            <div className="flex min-w-0 flex-col">
              <span className="text-gate-caption text-gate-ink-2">
                {section.label}
              </span>
              <span className="truncate text-gate-h3 font-semibold text-gate-ink">
                {title}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-gate-8">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="inline-flex h-10 items-center gap-gate-8 rounded-gate-input border border-gate-border bg-gate-surface px-gate-12 text-gate-body text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent"
              >
                <Search className="size-4" aria-hidden="true" />
                <span className="hidden lg:inline">Search</span>
                <kbd className="hidden rounded-gate-input border border-gate-border bg-gate-surface-2 px-gate-4 font-gate-mono text-gate-caption text-gate-ink-3 lg:inline">
                  ⌘K
                </kbd>
              </button>
              <ThemeToggle />
            </div>
          </header>

          <main
            id="gate-main"
            className="flex-1 px-gate-16 pb-gate-96 pt-gate-20 md:pb-gate-32 lg:px-gate-24"
          >
            {children}
          </main>
        </div>
      </div>

      <BottomTabs pathname={pathname} />
      <CommandPalette
        items={commandItems}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        placeholder="Jump to a screen, reference, TrxID or order…"
        emptyMessage="No matches. Try a payment reference or order id."
      />

      <span className="sr-only" aria-live="polite">
        {current ? `Current screen: ${current.label}` : ""}
      </span>
    </div>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const section = activeSection(pathname);
  const other = otherSection(pathname);

  return (
    <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col border-r border-gate-border bg-gate-surface md:flex lg:w-60">
      <Link
        href={section.items[0].href}
        className="flex h-16 items-center gap-gate-8 border-b border-gate-border px-gate-16"
        aria-label="PayGate"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-gate-input bg-gate-ink text-gate-body font-bold text-gate-bg">
          P
        </span>
        <span className="hidden flex-col lg:flex">
          <span className="text-gate-body font-semibold leading-tight text-gate-ink">
            PayGate
          </span>
          <span className="text-gate-caption leading-tight text-gate-ink-2">
            {section.shortLabel}
          </span>
        </span>
      </Link>

      <nav
        aria-label={section.label}
        className="flex flex-1 flex-col gap-gate-4 overflow-y-auto p-gate-8"
      >
        {section.items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "group flex h-11 items-center gap-gate-12 rounded-gate-input px-gate-12 text-gate-body font-medium transition-colors duration-[120ms] ease-gate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
                "justify-center lg:justify-start",
                active
                  ? "bg-gate-accent-soft text-gate-accent"
                  : "text-gate-ink-2 hover:bg-gate-surface-2 hover:text-gate-ink"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-gate-4 border-t border-gate-border p-gate-8">
        <Link
          href={other.items[0].href}
          title={`Switch to ${other.label}`}
          className="flex h-11 items-center gap-gate-12 rounded-gate-input px-gate-12 text-gate-body font-medium text-gate-ink-2 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 hover:text-gate-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent justify-center lg:justify-start"
        >
          <ArrowLeftRight className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline">{other.shortLabel}</span>
        </Link>
      </div>
    </aside>
  );
}

function BottomTabs({ pathname }: { pathname: string }) {
  const section = activeSection(pathname);

  return (
    <nav
      aria-label={section.label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gate-border bg-gate-surface md:hidden"
    >
      <ul className="grid grid-cols-6">
        {section.items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-gate-2 px-gate-4 py-gate-8 text-gate-caption font-medium transition-colors duration-[120ms] ease-gate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gate-accent",
                  active ? "text-gate-accent" : "text-gate-ink-2"
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="leading-tight">{item.label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
