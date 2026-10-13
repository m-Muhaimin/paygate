import { formatBdt, formatBdtCompact, paisaFromBdt } from "@/lib/domain/money";
import { PROVIDERS, type Provider } from "@/lib/domain/providers";

export { formatBdt, formatBdtCompact, paisaFromBdt };

/** Parse a "Tk" input value into integer paisa, or `null` when blank/invalid. */
export function paisaFromInput(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Format integer paisa as a plain decimal string for an editable input. */
export function paisaToInput(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) return "";
  return (paisa / 100).toFixed(2);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Mask a wallet MSISDN: `01712•••789`. */
export function maskMsisdn(msisdn: string): string {
  const digits = msisdn.replace(/\s/g, "");
  if (digits.length <= 6) return digits;
  const head = digits.slice(0, 5);
  const tail = digits.slice(-3);
  return `${head}•••${tail}`;
}

export function providerLabel(provider: Provider): string {
  return PROVIDERS[provider]?.label ?? provider;
}

export function providerColor(provider: Provider): string {
  return PROVIDERS[provider]?.colorHex ?? "#8A8A94";
}

/** True when a heartbeat is within the 3-minute live window (SPEC §5). */
export function isLive(lastHeartbeatAt: string | null | undefined): boolean {
  if (!lastHeartbeatAt) return false;
  const ts = new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < 3 * 60_000;
}

export const MIN_PAYOUT_PAISA = 100_000; // Tk 1,000 (SPEC §0)
export const MIN_PAYOUT_DISPLAY = "Tk 1,000.00";

export function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 10)}…${id.slice(-3)}`;
}
