/**
 * Display formatting for the customer-facing surface. Amounts are integer
 * paisa everywhere (SPEC §1), so BDT rendering always divides by 100.
 */

import type { Lang } from "./i18n";

/** Bengali digits, indexed 0-9. */
const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"] as const;

/** Replace ASCII digits with the locale's digits. */
export function localizeDigits(input: string, lang: Lang): string {
  if (lang !== "bn") return input;
  return input.replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)]);
}

const bdtFormatters: Record<Lang, Intl.NumberFormat> = {
  en: new Intl.NumberFormat("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  bn: new Intl.NumberFormat("bn-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

/**
 * Render an integer-paisa amount as `৳12,500.00` (locale digits, tabular when
 * the consumer applies `tabular-nums`).
 */
export function formatBDT(paisa: number, lang: Lang = "en"): string {
  const safe = Number.isFinite(paisa) ? paisa : 0;
  return `৳${bdtFormatters[lang].format(safe / 100)}`;
}

/**
 * Render a remaining duration as `MM:SS` (or `H:MM:SS` past an hour).
 * Negative values clamp to zero.
 */
export function formatCountdown(totalSeconds: number, lang: Lang = "en"): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  const raw =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(secs)}`
      : `${pad(minutes)}:${pad(secs)}`;
  return localizeDigits(raw, lang);
}

/** Format an ISO-8601 instant in the user's locale, e.g. "13 Oct, 14:05". */
export function formatDateTime(iso: string, lang: Lang = "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return formatter.format(date);
}
