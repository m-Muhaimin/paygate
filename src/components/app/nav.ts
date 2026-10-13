import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Banknote,
  Code2,
  CreditCard,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  Smartphone,
  Store,
  Wallet,
} from "lucide-react";

export type SectionId = "merchant" | "admin";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  id: SectionId;
  label: string;
  /** Short label for the icon rail / bottom tabs. */
  shortLabel: string;
  items: NavItem[];
}

export const MERCHANT_SECTION: NavSection = {
  id: "merchant",
  label: "Merchant dashboard",
  shortLabel: "Merchant",
  items: [
    { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { label: "Payments", href: "/payments", icon: CreditCard },
    { label: "Plans", href: "/plans", icon: Package },
    { label: "Settlements", href: "/settlements", icon: Banknote },
    { label: "Developers", href: "/developers", icon: Code2 },
    { label: "Settings", href: "/settings", icon: Settings },
  ],
};

export const ADMIN_SECTION: NavSection = {
  id: "admin",
  label: "Admin console",
  shortLabel: "Admin",
  items: [
    { label: "Fleet", href: "/admin/fleet", icon: Smartphone },
    { label: "Wallet pool", href: "/admin/wallets", icon: Wallet },
    { label: "Review queue", href: "/admin/review", icon: AlertTriangle },
    { label: "Payouts", href: "/admin/payouts", icon: Banknote },
    { label: "Merchants", href: "/admin/merchants", icon: Store },
    { label: "Audit log", href: "/admin/audit", icon: ScrollText },
  ],
};

export const SECTIONS: NavSection[] = [MERCHANT_SECTION, ADMIN_SECTION];

export function sectionForPath(pathname: string): SectionId {
  return pathname === "/admin" || pathname.startsWith("/admin/")
    ? "admin"
    : "merchant";
}

export function activeSection(pathname: string): NavSection {
  return sectionForPath(pathname) === "admin" ? ADMIN_SECTION : MERCHANT_SECTION;
}

export function otherSection(pathname: string): NavSection {
  return sectionForPath(pathname) === "admin" ? MERCHANT_SECTION : ADMIN_SECTION;
}

/** Longest-prefix match so `/payments/pay_1` still highlights Payments. */
export function activeItem(pathname: string): NavItem | undefined {
  const { items } = activeSection(pathname);
  let match: NavItem | undefined;
  for (const item of items) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!match || item.href.length > match.href.length) match = item;
    }
  }
  return match;
}

export function pageTitle(pathname: string): string {
  return activeItem(pathname)?.label ?? activeSection(pathname).label;
}
