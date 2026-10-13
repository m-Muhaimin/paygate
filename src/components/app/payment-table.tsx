"use client";

import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/gate";
import type { Payment } from "@/lib/client/query";

import { CopyButton, PaymentStatusBadge, ProviderBadge } from "./ui";
import { TableEmpty } from "./states";
import { formatBdt, formatRelative, providerLabel, shortId } from "./format";

/** Stop a nested control (copy button) from also triggering the row click. */
function RowSafe({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-gate-8"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

export function usePaymentColumns(): DataTableColumn<Payment>[] {
  return React.useMemo(
    () => [
      {
        key: "reference",
        header: "Reference",
        render: (row) => (
          <RowSafe>
            <span className="rounded-gate-input bg-gate-accent-soft px-gate-8 py-gate-4 font-gate-mono text-gate-mono font-medium text-gate-accent">
              {row.reference}
            </span>
            <CopyButton value={row.reference} label="reference" />
          </RowSafe>
        ),
      },
      {
        key: "id",
        header: "Payment ID",
        mono: true,
        render: (row) => (
          <RowSafe>
            <span title={row.id}>{shortId(row.id)}</span>
            <CopyButton value={row.id} label="payment id" />
          </RowSafe>
        ),
      },
      {
        key: "order_id",
        header: "Order",
        mono: true,
        render: (row) => row.order_id ?? <span className="text-gate-ink-3">—</span>,
      },
      {
        key: "provider",
        header: "Provider",
        render: (row) => (
          <ProviderBadge provider={row.provider} label={providerLabel(row.provider)} />
        ),
      },
      {
        key: "amount",
        header: "Amount",
        align: "right",
        mono: true,
        render: (row) => formatBdt(row.amount),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => <PaymentStatusBadge status={row.status} />,
      },
      {
        key: "created_at",
        header: "Created",
        align: "right",
        render: (row) => (
          <span className="text-gate-caption text-gate-ink-2">
            {formatRelative(row.created_at)}
          </span>
        ),
      },
    ],
    []
  );
}

export interface PaymentTableProps {
  payments: Payment[];
  onRowClick?: (payment: Payment) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

export function PaymentTable({
  payments,
  onRowClick,
  emptyTitle = "No payments yet",
  emptyDescription = "Payments appear here the moment you create one with the API or a plan link.",
  emptyAction,
  className,
}: PaymentTableProps) {
  const columns = usePaymentColumns();

  return (
    <DataTable<Payment>
      caption="Payments"
      columns={columns}
      rows={payments}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      rowHeight={48}
      className={className}
      emptyState={
        <TableEmpty
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      }
    />
  );
}
