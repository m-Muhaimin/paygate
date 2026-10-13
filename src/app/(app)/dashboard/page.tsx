"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";

import { Button, StatCard, type StatCardDelta } from "@/components/gate";
import {
  getAdminDevices,
  getBalance,
  getPayments,
  queryKeys,
  type Payment,
} from "@/lib/client/query";

import { PaymentDrawer } from "@/components/app/payment-drawer";
import { PaymentTable } from "@/components/app/payment-table";
import {
  Card,
  CardBody,
  CardHeader,
  GenericStatus,
  PageHeader,
  PaymentStatusBadge,
} from "@/components/app/ui";
import { StatCardsSkeleton, TableSkeleton } from "@/components/app/skeleton";
import { ErrorState } from "@/components/app/states";
import { formatBdt, formatCount, formatRelative, isLive } from "@/components/app/format";

const PAYMENT_LIMIT = 50;

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

interface Trend {
  series: number[];
  delta: StatCardDelta | undefined;
  todayTotal: number;
}

function buildTrend(payments: Payment[]): Trend {
  const days: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const totals = new Map<string, number>(days.map((day) => [day, 0]));
  for (const payment of payments) {
    const stamp = payment.paid_at ?? payment.created_at;
    const key = dayKey(stamp);
    if (payment.status === "paid" && totals.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + payment.net_amount);
    }
  }

  const series = days.map((day) => totals.get(day) ?? 0);
  const today = series[series.length - 1] ?? 0;
  const yesterday = series[series.length - 2] ?? 0;

  let delta: StatCardDelta | undefined;
  if (yesterday === 0 && today === 0) {
    delta = undefined;
  } else if (yesterday === 0) {
    delta = { value: "New today", direction: "up" };
  } else {
    const pct = ((today - yesterday) / yesterday) * 100;
    const rounded = Math.round(Math.abs(pct));
    delta = {
      value: `${pct >= 0 ? "+" : "-"}${rounded}% vs yesterday`,
      direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat",
    };
  }

  return { series, delta, todayTotal: today };
}

export default function OverviewPage() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const balance = useQuery({
    queryKey: queryKeys.balance,
    queryFn: getBalance,
  });
  const payments = useQuery({
    queryKey: queryKeys.payments({ limit: PAYMENT_LIMIT }),
    queryFn: () => getPayments({ limit: PAYMENT_LIMIT }),
  });
  // Devices are platform-scoped; if the merchant session cannot read them this
  // silently contributes nothing to the attention queue.
  const devices = useQuery({
    queryKey: queryKeys.adminDevices,
    queryFn: getAdminDevices,
    retry: false,
  });

  const rows = payments.data ?? [];
  const trend = React.useMemo(() => buildTrend(payments.data ?? []), [payments.data]);

  const awaiting = rows.filter(
    (payment) => payment.status === "awaiting_payment" || payment.status === "created"
  );
  const reviews = rows.filter((payment) => payment.status === "needs_review");
  const unmatched = reviews.filter((payment) => payment.review_reason === "unmatched");
  const offlineDevices = (devices.data ?? []).filter(
    (device) => device.status === "active" && !isLive(device.last_heartbeat_at)
  );

  const refreshAll = () => {
    void balance.refetch();
    void payments.refetch();
    void devices.refetch();
  };

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Overview"
        description="Today's money, what needs your attention, and the latest payments."
        actions={
          <Button
            variant="secondary"
            onClick={refreshAll}
            loading={payments.isFetching || balance.isFetching}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {balance.isError ? (
        <ErrorState error={balance.error} onRetry={() => void balance.refetch()} />
      ) : null}

      {balance.isPending || payments.isPending ? (
        <StatCardsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-gate-16 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            caption="Available balance"
            value={balance.data ? formatBdt(balance.data.available) : "—"}
            sparkline={trend.series}
            sparklineColor="accent"
          />
          <StatCard
            caption="Paid today"
            value={formatBdt(trend.todayTotal)}
            delta={trend.delta}
            sparkline={trend.series}
            sparklineColor="success"
          />
          <StatCard
            caption="Awaiting payment"
            value={formatCount(awaiting.length)}
            delta={
              awaiting.length > 0
                ? { value: `${awaiting.length} open`, direction: "flat" }
                : undefined
            }
          />
          <StatCard
            caption="Needs review"
            value={formatCount(reviews.length)}
            delta={
              reviews.length > 0
                ? { value: "Action required", direction: "down" }
                : { value: "All clear", direction: "up" }
            }
            sparklineColor="warning"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-gate-20 xl:grid-cols-[minmax(0,360px)_1fr]">
        <Card className="self-start">
          <CardHeader
            title="Attention queue"
            description="Resolve these to keep matching healthy."
          />
          <CardBody className="flex flex-col gap-gate-4 p-gate-8">
            {payments.isPending ? (
              <div className="flex flex-col gap-gate-8 p-gate-12">
                <div className="h-4 w-full animate-pulse rounded bg-gate-surface-2" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-gate-surface-2" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-gate-surface-2" />
              </div>
            ) : attentionItems(reviews, unmatched, offlineDevices).length === 0 ? (
              <p className="p-gate-16 text-gate-body text-gate-ink-2">
                Nothing needs your attention right now.
              </p>
            ) : (
              attentionItems(reviews, unmatched, offlineDevices)
                .slice(0, 6)
                .map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-center justify-between gap-gate-12 rounded-gate-input px-gate-12 py-gate-10 transition-colors duration-[120ms] ease-gate hover:bg-gate-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent"
                  >
                    <span className="flex min-w-0 flex-col gap-gate-2">
                      <span className="truncate text-gate-body font-medium text-gate-ink">
                        {item.title}
                      </span>
                      <span className="truncate text-gate-caption text-gate-ink-2">
                        {item.description}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-gate-8">
                      {item.badge}
                      <ChevronRight className="size-4 text-gate-ink-3" aria-hidden="true" />
                    </span>
                  </Link>
                ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent payments"
            description="The latest 50 payments across every provider."
            actions={
              <Link
                href="/payments"
                className="inline-flex items-center gap-gate-4 text-gate-body font-medium text-gate-accent hover:underline"
              >
                View all
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            }
          />
          <div className="p-gate-16">
            {payments.isPending ? (
              <TableSkeleton rows={6} columns={6} />
            ) : payments.isError ? (
              <ErrorState
                error={payments.error}
                onRetry={() => void payments.refetch()}
              />
            ) : (
              <PaymentTable
                payments={rows.slice(0, 8)}
                onRowClick={(payment) => setSelectedId(payment.id)}
                emptyTitle="No payments yet"
                emptyDescription="Create your first payment with the API to see it here."
              />
            )}
          </div>
        </Card>
      </div>

      <PaymentDrawer
        paymentId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
      />

      {devices.isError && !payments.isError ? (
        <p className="text-gate-caption text-gate-ink-3">
          Fleet telemetry unavailable for this session — device signals are hidden
          from the attention queue.
        </p>
      ) : null}
    </div>
  );
}

interface AttentionItem {
  id: string;
  title: string;
  description: string;
  href: string;
  badge: React.ReactNode;
}

function attentionItems(
  reviews: Payment[],
  unmatched: Payment[],
  offlineDevices: { id: string; name: string | null; last_heartbeat_at: string | null }[]
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const payment of reviews) {
    items.push({
      id: `review-${payment.id}`,
      title: `Review ${payment.reference}`,
      description: `${formatBdt(payment.amount)} · ${payment.review_reason ?? "held"}`,
      href: `/payments?id=${payment.id}`,
      badge: <PaymentStatusBadge status={payment.status} />,
    });
  }

  for (const payment of unmatched) {
    items.push({
      id: `unmatched-${payment.id}`,
      title: "Unmatched incoming transfer",
      description: `${payment.reference} · ${formatBdt(payment.amount)}`,
      href: `/payments?id=${payment.id}`,
      badge: <GenericStatus status="pending" label="Unmatched" />,
    });
  }

  for (const device of offlineDevices) {
    items.push({
      id: `device-${device.id}`,
      title: `${device.name ?? "Device"} offline`,
      description: `Last heartbeat ${formatRelative(device.last_heartbeat_at)}`,
      href: "/admin/fleet",
      badge: <GenericStatus status="offline" />,
    });
  }

  return items;
}
