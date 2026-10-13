"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/gate";
import { Select } from "@/components/app/form-controls";
import { PaymentDrawer } from "@/components/app/payment-drawer";
import { PaymentTable } from "@/components/app/payment-table";
import { PageHeader, Toolbar } from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState } from "@/components/app/states";
import { formatCount } from "@/components/app/format";
import {
  getPayments,
  queryKeys,
  type Payment,
  type PaymentFilters,
  type PaymentStatus,
  type Provider,
} from "@/lib/client/query";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "created", label: "Created" },
  { value: "awaiting_payment", label: "Awaiting payment" },
  { value: "paid", label: "Paid" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
  { value: "needs_review", label: "Needs review" },
];

const PROVIDER_OPTIONS = [
  { value: "all", label: "All providers" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
];

const PAYMENT_LIMIT = 100;

function matchesFilters(payment: Payment, filters: PaymentFilters): boolean {
  if (filters.status && filters.status !== "all" && payment.status !== filters.status) {
    return false;
  }
  if (
    filters.provider &&
    filters.provider !== "all" &&
    payment.provider !== filters.provider
  ) {
    return false;
  }
  const q = (filters.q ?? "").trim().toLowerCase();
  if (!q) return true;
  return [
    payment.reference,
    payment.id,
    payment.order_id ?? "",
    payment.submitted_trx_id ?? "",
  ].some((value) => value.toLowerCase().includes(q));
}

function PaymentsView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const initialId = searchParams.get("id");

  const [status, setStatus] = React.useState<string>("all");
  const [provider, setProvider] = React.useState<string>("all");
  const [q, setQ] = React.useState(initialQuery);
  const [debouncedQ, setDebouncedQ] = React.useState(initialQuery);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialId);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const filters: PaymentFilters = {
    status: status as PaymentStatus | "all",
    provider: provider as Provider | "all",
    q: debouncedQ || undefined,
    limit: PAYMENT_LIMIT,
  };

  const query = useQuery({
    queryKey: queryKeys.payments(filters),
    queryFn: () => getPayments(filters),
  });

  const rows = React.useMemo(
    () => (query.data ?? []).filter((payment) => matchesFilters(payment, filters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, status, provider, debouncedQ]
  );

  const hasFilters = status !== "all" || provider !== "all" || debouncedQ !== "";

  return (
    <div className="flex flex-col gap-gate-20">
      <PageHeader
        title="Payments"
        description="Every payment across bKash, Nagad and Rocket. Open a row to inspect its timeline."
      />

      <Toolbar>
        <Input
          label="Search"
          placeholder="Reference, payment ID, order or TrxID"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          containerClassName="min-w-[240px] flex-1"
          type="search"
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={STATUS_OPTIONS}
          containerClassName="w-full sm:w-44"
        />
        <Select
          label="Provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          options={PROVIDER_OPTIONS}
          containerClassName="w-full sm:w-44"
        />
      </Toolbar>

      <div className="flex flex-wrap items-center justify-between gap-gate-8">
        <p className="text-gate-caption text-gate-ink-2">
          {query.isPending
            ? "Loading payments…"
            : `${formatCount(rows.length)} payment${rows.length === 1 ? "" : "s"}${
                hasFilters ? " match these filters" : ""
              }`}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setProvider("all");
              setQ("");
            }}
            className="text-gate-caption font-medium text-gate-accent hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {query.isPending ? (
        <TableSkeleton rows={10} columns={7} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <PaymentTable
          payments={rows}
          onRowClick={(payment) => setSelectedId(payment.id)}
          emptyTitle={hasFilters ? "No matching payments" : "No payments yet"}
          emptyDescription={
            hasFilters
              ? "Try a different reference, status or provider."
              : "Payments appear here the moment you create one with the API."
          }
          emptyAction={
            hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setStatus("all");
                  setProvider("all");
                  setQ("");
                }}
                className="text-gate-body font-medium text-gate-accent hover:underline"
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}

      <PaymentDrawer
        paymentId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-gate-20">
          <PageHeader title="Payments" />
          <TableSkeleton rows={10} columns={7} />
        </div>
      }
    >
      <PaymentsView />
    </Suspense>
  );
}
