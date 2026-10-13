"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, X } from "lucide-react";

import { Banner, Button, DataTable, useToast } from "@/components/gate";
import { Select, Textarea } from "@/components/app/form-controls";
import { Drawer } from "@/components/app/drawer";
import {
  Card,
  CardHeader,
  GenericStatus,
  PageHeader,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  approvePayout,
  errorMessage,
  getAdminPayouts,
  queryKeys,
  rejectPayout,
  type Payout,
  type PayoutStatus,
} from "@/lib/client/query";
import {
  formatBdt,
  formatDateTime,
  providerLabel,
} from "@/components/app/format";

type Decision = "approve" | "reject";

const STATUS_FILTERS: { value: PayoutStatus | "all"; label: string }[] = [
  { value: "requested", label: "Awaiting decision" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All statuses" },
];

function destinationLabel(payout: Payout): string {
  const dest = payout.destination;
  if (!dest) return "—";
  if (payout.rail === "bank") {
    return `${dest.bank_name ?? "Bank"} · ${dest.account_no ?? "—"}`;
  }
  const provider = dest.provider ? providerLabel(dest.provider) : "Wallet";
  return `${provider} · ${dest.account_no ?? "—"}`;
}

function DecisionDrawer({
  payout,
  decision,
  onClose,
}: {
  payout: Payout | null;
  decision: Decision | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Reset the decision form whenever a new payout is opened (see
  // "adjusting state when props change" — state is reset during render).
  const [prevPayout, setPrevPayout] = React.useState(payout);
  if (payout !== prevPayout) {
    setPrevPayout(payout);
    setNote("");
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!payout || !decision) throw new Error("Nothing to decide");
      return decision === "approve"
        ? approvePayout(payout.id, note.trim() || undefined)
        : rejectPayout(payout.id, note.trim());
    },
    onSuccess: () => {
      toast({
        title: decision === "approve" ? "Payout approved" : "Payout rejected",
        description:
          decision === "approve"
            ? "It will be released by the payments team."
            : "The merchant can request a new payout.",
        variant: decision === "approve" ? "success" : "info",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminPayouts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAudit({}) });
      onClose();
    },
    onError: (mutationError) =>
      toast({
        title: "Could not record the decision",
        description: errorMessage(mutationError),
        variant: "danger",
      }),
  });

  const submit = () => {
    if (decision === "reject" && !note.trim()) {
      setError("A reason is required when rejecting.");
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <Drawer
      open={Boolean(payout && decision)}
      onClose={onClose}
      title={decision === "reject" ? "Reject payout" : "Approve payout"}
      description={
        payout
          ? `${formatBdt(payout.amount)} to ${destinationLabel(payout)}`
          : undefined
      }
      footer={
        <div className="flex justify-end gap-gate-8">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant={decision === "reject" ? "danger" : "primary"}
            onClick={submit}
            loading={mutation.isPending}
          >
            {decision === "reject" ? "Reject payout" : "Approve payout"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-gate-16">
        {decision === "approve" ? (
          <Banner
            variant="info"
            title="Maker-checker"
            description="Only a different admin may approve this request. The decision is written to the audit log with your identity."
          />
        ) : null}
        {payout ? (
          <dl className="grid grid-cols-2 gap-gate-16 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-16">
            <div className="flex flex-col gap-gate-4">
              <dt className="text-gate-caption text-gate-ink-2">Requested by</dt>
              <dd className="font-gate-mono text-gate-mono text-gate-ink">
                {payout.requested_by ?? "unknown"}
              </dd>
            </div>
            <div className="flex flex-col gap-gate-4">
              <dt className="text-gate-caption text-gate-ink-2">Requested at</dt>
              <dd className="text-gate-body text-gate-ink">
                {formatDateTime(payout.created_at)}
              </dd>
            </div>
          </dl>
        ) : null}
        <Textarea
          label={decision === "reject" ? "Reason" : "Note (optional)"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            decision === "reject"
              ? "Explain why this payout cannot proceed."
              : "Anything the payments team should know."
          }
          hint={decision === "reject" ? "Required when rejecting." : undefined}
        />
        {error ? (
          <p role="alert" className="text-gate-caption text-gate-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

export default function AdminPayoutsPage() {
  const [status, setStatus] = React.useState<PayoutStatus | "all">("requested");
  const [payout, setPayout] = React.useState<Payout | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);

  const query = useQuery({
    queryKey: queryKeys.adminPayouts,
    queryFn: getAdminPayouts,
  });

  const all = query.data ?? [];
  const rows = status === "all" ? all : all.filter((item) => item.status === status);
  const pendingTotal = all
    .filter((item) => item.status === "requested")
    .reduce((sum, item) => sum + item.amount, 0);

  const decide = (target: Payout, nextDecision: Decision) => {
    setPayout(target);
    setDecision(nextDecision);
  };

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Payouts"
        description="Maker-checker: a payout requested by one admin must be approved by another."
        actions={
          <Button
            variant="secondary"
            onClick={() => void query.refetch()}
            loading={query.isFetching}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Queue"
          description={
            all.length > 0
              ? `${all.filter((item) => item.status === "requested").length} awaiting decision · ${formatBdt(
                  pendingTotal
                )} requested`
              : undefined
          }
          actions={
            <div className="w-56">
              <Select
                label="Status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as PayoutStatus | "all")
                }
                options={STATUS_FILTERS}
                containerClassName="gap-gate-4"
              />
            </div>
          }
        />
        <div className="p-gate-16">
          {query.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <DataTable<Payout>
              caption="Payout requests"
              getRowId={(item) => item.id}
              rows={rows}
              rowHeight={56}
              columns={[
                {
                  key: "amount",
                  header: "Amount",
                  mono: true,
                  render: (item) => (
                    <span className="font-gate-mono text-gate-mono tabular-nums text-gate-ink">
                      {formatBdt(item.amount)}
                    </span>
                  ),
                },
                {
                  key: "merchant",
                  header: "Merchant",
                  render: (item) => (
                    <span className="font-gate-mono text-gate-caption text-gate-ink-2">
                      {item.merchant_id}
                    </span>
                  ),
                },
                {
                  key: "destination",
                  header: "Destination",
                  render: (item) => (
                    <span className="flex flex-col">
                      <span className="text-gate-body text-gate-ink">
                        {item.rail === "bank" ? "Bank" : "MFS"}
                      </span>
                      <span className="font-gate-mono text-gate-caption text-gate-ink-2">
                        {destinationLabel(item)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "requested_by",
                  header: "Requested by",
                  render: (item) => (
                    <span className="font-gate-mono text-gate-caption text-gate-ink-2">
                      {item.requested_by ?? "unknown"}
                    </span>
                  ),
                },
                {
                  key: "created_at",
                  header: "Requested",
                  align: "right",
                  render: (item) => (
                    <span className="text-gate-caption text-gate-ink-2">
                      {formatDateTime(item.created_at)}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (item) => (
                    <span className="flex flex-col gap-gate-4">
                      <GenericStatus status={item.status} />
                      {item.note ? (
                        <span className="text-gate-caption text-gate-ink-3">
                          {item.note}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "Decision",
                  align: "right",
                  render: (item) =>
                    item.status === "requested" ? (
                      <span className="inline-flex items-center gap-gate-8">
                        <Button
                          onClick={() => decide(item, "approve")}
                          aria-label={`Approve ${formatBdt(item.amount)} payout`}
                        >
                          <Check className="size-4" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => decide(item, "reject")}
                          aria-label={`Reject ${formatBdt(item.amount)} payout`}
                        >
                          <X className="size-4" aria-hidden="true" />
                          Reject
                        </Button>
                      </span>
                    ) : item.approved_by ? (
                      <span className="text-gate-caption text-gate-ink-2">
                        by {item.approved_by}
                      </span>
                    ) : null,
                },
              ]}
              emptyState={
                <TableEmpty
                  title={status === "requested" ? "Nothing to approve" : "No payouts"}
                  description={
                    status === "requested"
                      ? "Every payout request has been decided."
                      : "Payout requests from merchants will appear here."
                  }
                />
              }
            />
          )}
        </div>
      </Card>

      <DecisionDrawer
        payout={payout}
        decision={decision}
        onClose={() => {
          setPayout(null);
          setDecision(null);
        }}
      />
    </div>
  );
}
