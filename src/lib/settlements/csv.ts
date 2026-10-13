/**
 * Settlement CSV export (SPEC §7 `GET /v1/settlements/export`).
 *
 * Pure, dependency-free serializer so it can be unit-tested and reused for any
 * tabular export. Amounts stay integer paisa (no locale formatting) so the CSV is
 * machine-readable; the header mirrors the `settlements` columns.
 */

import type { Settlement } from "@/lib/db/types";

/** Column order for the export. */
export const SETTLEMENT_CSV_COLUMNS = [
  "id",
  "merchant_id",
  "period_start",
  "period_end",
  "gross_amount",
  "fee_amount",
  "net_amount",
  "status",
  "created_at",
] as const;

/** RFC 4180 field escaping: wrap when the value contains `,` `"` CR or LF. */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serialize settlement rows to an RFC 4180 CSV document (CRLF, trailing newline). */
export function settlementsToCsv(rows: readonly Settlement[]): string {
  const header = SETTLEMENT_CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    SETTLEMENT_CSV_COLUMNS.map((column) => escapeCsvField(row[column])).join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
