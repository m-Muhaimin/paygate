"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import {
  Banner,
  Button,
  ReferenceChip,
  Timeline,
  useToast,
  type TimelineItem,
} from "@/components/gate";
import {
  cancelPayment,
  errorMessage,
  getPayment,
  queryKeys,
  type Payment,
} from "@/lib/client/query";
import { cn } from "@/lib/utils";

import { Drawer } from "./drawer";
import { KeyValue, PaymentStatusBadge, ProviderBadge } from "./ui";
import {
  formatBdt,
  formatDateTime,
  formatRelative,
  providerLabel,
} from "./format";

const REVIEW_COPY: Record<string, string> = {
  underpaid: "The amount received was less than the payment amount.",
  overpaid: "The amount received was more than the payment amount.",
  wrong_wallet: "The funds landed on a wallet not offered to this payment.",
  late_payment: "The payment had already expired when the funds arrived.",
  duplicate_ref: "This reference was already claimed by another payment.",
  conflict: "The reference and TrxID point at different payments.",
  unmatched: "No payment matched this incoming transaction.",
};

function buildTimeline(payment: Payment): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: "created",
      title: "Payment created",
      description: payment.order_id ? `Order ${payment.order_id}` : undefined,
      timestamp: formatDateTime(payment.created_at),
      status: "done",
    },
  ];

  const terminal = ["paid", "expired", "cancelled", "needs_review"].includes(
    payment.status
  );

  items.push({
    id: "awaiting",
    title: "Awaiting payment",
    description: `Reference ${payment.reference} offered on ${providerLabel(
      payment.provider
    )}.`,
    timestamp: payment.status === "created" ? "—" : formatDateTime(payment.created_at),
    status: terminal ? "done" : "current",
  });

  if (payment.status === "paid") {
    items.push({
      id: "paid",
      title: "Payment matched",
      description: payment.matched_by
        ? `Matched by ${payment.matched_by === "trxid" ? "TrxID" : "reference"}.`
        : "Funds received.",
      timestamp: formatDateTime(payment.paid_at),
      status: "done",
    });
  } else if (payment.status === "needs_review") {
    items.push({
      id: "review",
      title: "Held for review",
      description: payment.review_reason
        ? REVIEW_COPY[payment.review_reason]
        : "An operator needs to resolve this payment.",
      timestamp: formatDateTime(payment.created_at),
      status: "error",
    });
  } else if (payment.status === "expired" || payment.status === "cancelled") {
    items.push({
      id: "terminal",
      title: payment.status === "expired" ? "Payment expired" : "Payment cancelled",
      timestamp: formatDateTime(payment.expires_at ?? payment.created_at),
      status: "upcoming",
    });
  } else {
    items.push({
      id: "paid",
      title: "Waiting for funds",
      description: "The payment is confirmed the moment the wallet SMS arrives.",
      timestamp: payment.expires_at
        ? `Expires ${formatDateTime(payment.expires_at)}`
        : "—",
      status: "upcoming",
    });
  }

  return items;
}

export interface PaymentDrawerProps {
  paymentId: string | null;
  open: boolean;
  onClose: () => void;
}

export function PaymentDrawer({ paymentId, open, onClose }: PaymentDrawerProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: queryKeys.payment(paymentId ?? "none"),
    queryFn: () => getPayment(paymentId as string),
    enabled: open && Boolean(paymentId),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelPayment(id),
    onSuccess: (updated) => {
      toast({ title: "Payment cancelled", variant: "success" });
      queryClient.setQueryData(queryKeys.payment(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
    },
    onError: (error) => {
      toast({
        title: "Could not cancel payment",
        description: errorMessage(error),
        variant: "danger",
      });
    },
  });

  const payment = query.data;
  const cancellable =
    payment && (payment.status === "created" || payment.status === "awaiting_payment");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={payment ? `Payment ${payment.reference}` : "Payment"}
      description={
        payment ? (
          <span className="flex items-center gap-gate-8">
            <PaymentStatusBadge status={payment.status} />
            <span className="font-gate-mono text-gate-caption text-gate-ink-3">
              {payment.id}
            </span>
          </span>
        ) : undefined
      }
      footer={
        payment && cancellable ? (
          <div className="flex justify-end">
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => cancel.mutate(payment.id)}
            >
              Cancel payment
            </Button>
          </div>
        ) : null
      }
    >
      {query.isPending ? (
        <div className="flex flex-col gap-gate-16" role="status" aria-label="Loading">
          <div className="h-8 w-40 animate-pulse rounded-gate-input bg-gate-surface-2" />
          <div className="h-4 w-full animate-pulse rounded-gate-input bg-gate-surface-2" />
          <div className="h-4 w-3/4 animate-pulse rounded-gate-input bg-gate-surface-2" />
        </div>
      ) : query.isError ? (
        <Banner
          variant="danger"
          title="Could not load payment"
          description={errorMessage(query.error)}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : payment ? (
        <div className="flex flex-col gap-gate-24">
          <div className="flex flex-wrap items-center gap-gate-12">
            <ReferenceChip reference={payment.reference} label="Reference" />
            <span className="font-gate-mono text-gate-h2 font-semibold tabular-nums text-gate-ink">
              {formatBdt(payment.amount)}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-gate-16">
            <KeyValue
              label="Net to you"
              value={formatBdt(payment.net_amount)}
              mono
            />
            <KeyValue label="Fee" value={formatBdt(payment.fee_amount)} mono />
            <KeyValue
              label="Provider"
              value={
                <ProviderBadge
                  provider={payment.provider}
                  label={providerLabel(payment.provider)}
                />
              }
            />
            <KeyValue
              label="Order"
              value={payment.order_id ?? "—"}
              mono={Boolean(payment.order_id)}
            />
            <KeyValue
              label="Matched by"
              value={
                payment.matched_by === "trxid"
                  ? "TrxID"
                  : payment.matched_by === "reference"
                    ? "Reference"
                    : "—"
              }
            />
            <KeyValue
              label="Submitted TrxID"
              value={payment.submitted_trx_id ?? "—"}
              mono={Boolean(payment.submitted_trx_id)}
            />
            <KeyValue
              label="Created"
              value={`${formatDateTime(payment.created_at)} · ${formatRelative(
                payment.created_at
              )}`}
            />
            <KeyValue
              label="Paid"
              value={payment.paid_at ? formatDateTime(payment.paid_at) : "—"}
            />
          </dl>

          {payment.review_reason ? (
            <Banner
              variant="warning"
              title={`Needs review · ${payment.review_reason}`}
              description={REVIEW_COPY[payment.review_reason]}
            />
          ) : null}

          {payment.callback_url ? (
            <div className="flex flex-col gap-gate-8">
              <p className="text-gate-caption text-gate-ink-2">Callback URL</p>
              <a
                href={payment.callback_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-gate-4 break-all font-gate-mono text-gate-caption text-gate-accent hover:underline"
              >
                {payment.callback_url}
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              </a>
            </div>
          ) : null}

          <div className="flex flex-col gap-gate-16">
            <h3 className="text-gate-h3 font-semibold text-gate-ink">History</h3>
            <Timeline items={buildTimeline(payment)} />
          </div>
        </div>
      ) : (
        <Banner variant="info" title="Payment not found" />
      )}
    </Drawer>
  );
}

/** Small helper used by tables that need a clickable mono id. */
export function MonoButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-gate-input text-left font-gate-mono text-gate-mono text-gate-ink transition-colors duration-[120ms] ease-gate hover:text-gate-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
        className
      )}
    >
      {children}
    </button>
  );
}
