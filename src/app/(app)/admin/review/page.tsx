"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import { Banner, Button, useToast } from "@/components/gate";
import { Textarea } from "@/components/app/form-controls";
import {
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  KeyValue,
  PageHeader,
  PaymentStatusBadge,
  ProviderBadge,
  StatusPill,
} from "@/components/app/ui";
import { LinesSkeleton, TableSkeleton } from "@/components/app/skeleton";
import { ErrorState } from "@/components/app/states";
import {
  errorMessage,
  getAdminReview,
  queryKeys,
  resolveReview,
  type Payment,
  type ReviewCase,
  type ReviewResolution,
} from "@/lib/client/query";
import { cn } from "@/lib/utils";
import {
  formatBdt,
  formatDateTime,
  formatRelative,
  providerLabel,
} from "@/components/app/format";

const REASON_COPY: Record<string, { label: string; description: string }> = {
  underpaid: {
    label: "Underpaid",
    description: "The incoming amount is lower than the payment asked for.",
  },
  overpaid: {
    label: "Overpaid",
    description: "The incoming amount is higher than the payment asked for.",
  },
  wrong_wallet: {
    label: "Wrong wallet",
    description: "Money landed on a number the payment was not assigned to.",
  },
  late_payment: {
    label: "Late payment",
    description: "The payment had already expired when the money arrived.",
  },
  duplicate_ref: {
    label: "Duplicate reference",
    description: "This reference was already matched to another payment.",
  },
  conflict: {
    label: "Conflict",
    description: "More than one payment could claim this transaction.",
  },
  unmatched: {
    label: "Unmatched",
    description: "No reference and no TrxID matched any pending payment.",
  },
};

function reasonCopy(reason: string | null) {
  return (
    REASON_COPY[reason ?? ""] ?? {
      label: reason ? reason.replace(/_/g, " ") : "Needs review",
      description: "A human needs to decide where this money belongs.",
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Case list                                                                    */
/* -------------------------------------------------------------------------- */

function CaseList({
  cases,
  selectedId,
  onSelect,
}: {
  cases: ReviewCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex max-h-[70vh] flex-col gap-gate-8 overflow-y-auto p-gate-8">
      {cases.map((item) => {
        const copy = reasonCopy(item.reason);
        const active = item.id === selectedId;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex w-full flex-col gap-gate-8 rounded-gate-input border p-gate-12 text-left transition-colors duration-[120ms] ease-gate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
                active
                  ? "border-gate-accent bg-gate-accent-soft"
                  : "border-gate-border bg-gate-surface hover:bg-gate-surface-2"
              )}
            >
              <span className="flex items-center justify-between gap-gate-8">
                <StatusPill
                  label={copy.label}
                  tone={item.reason === "conflict" || item.reason === "duplicate_ref" ? "danger" : "warning"}
                />
                <span className="text-gate-caption text-gate-ink-2">
                  {formatRelative(item.created_at)}
                </span>
              </span>
              <span className="font-gate-mono text-gate-mono tabular-nums text-gate-ink">
                {item.incoming ? formatBdt(item.incoming.amount) : "—"}
              </span>
              <span className="truncate font-gate-mono text-gate-caption text-gate-ink-2">
                {item.incoming?.ref_normalized ??
                  item.incoming?.ref_raw ??
                  item.suggested_reference ??
                  "no reference"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Case detail                                                                  */
/* -------------------------------------------------------------------------- */

function CandidateOption({
  payment,
  selected,
  onSelect,
  reference,
}: {
  payment: Payment;
  selected: boolean;
  onSelect: () => void;
  reference: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-gate-12 rounded-gate-input border p-gate-12 text-left transition-colors duration-[120ms] ease-gate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
        selected
          ? "border-gate-accent bg-gate-accent-soft"
          : "border-gate-border bg-gate-surface hover:bg-gate-surface-2"
      )}
    >
      <span className="flex min-w-0 flex-col gap-gate-4">
        <span className="truncate font-gate-mono text-gate-mono text-gate-ink">
          {payment.reference}
        </span>
        <span className="text-gate-caption text-gate-ink-2">
          {providerLabel(payment.provider)} · created{" "}
          {formatRelative(payment.created_at)}
          {payment.order_id ? ` · order ${payment.order_id}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-gate-8">
        <span className="font-gate-mono text-gate-mono tabular-nums text-gate-ink">
          {formatBdt(payment.amount)}
        </span>
        <PaymentStatusBadge status={payment.status} />
      </span>
      <span className="sr-only">
        {selected ? `${reference} selected` : `Select ${reference}`}
      </span>
    </button>
  );
}

function CaseDetail({ item }: { item: ReviewCase }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const candidates = React.useMemo(() => {
    const list = [...item.candidates];
    if (item.payment && !list.some((payment) => payment.id === item.payment?.id)) {
      list.unshift(item.payment);
    }
    return list;
  }, [item.candidates, item.payment]);

  const [candidateId, setCandidateId] = React.useState<string | null>(
    () => item.payment?.id ?? null
  );
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Reset the decision form when switching cases (see "adjusting state when
  // props change" — state is reset during render).
  const [prevCaseId, setPrevCaseId] = React.useState(item.id);
  if (item.id !== prevCaseId) {
    setPrevCaseId(item.id);
    setCandidateId(item.payment?.id ?? null);
    setNote("");
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: (input: ReviewResolution) => resolveReview(item.id, input),
    onSuccess: (_data, input) => {
      toast({
        title:
          input.resolution === "rejected"
            ? "Case rejected"
            : input.resolution === "matched"
              ? "Payment matched"
              : "Payment accepted",
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminReview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminAudit({}) });
    },
    onError: (mutationError) =>
      toast({
        title: "Could not resolve this case",
        description: errorMessage(mutationError),
        variant: "danger",
      }),
  });

  const run = (resolution: ReviewResolution["resolution"]) => {
    if (resolution === "matched" && !candidateId) {
      setError("Pick the payment this transaction belongs to.");
      return;
    }
    if (resolution === "rejected" && !note.trim()) {
      setError("A reason is required when rejecting.");
      return;
    }
    setError(null);
    mutation.mutate({
      resolution,
      note: note.trim(),
      payment_id: resolution === "matched" ? candidateId : null,
    });
  };

  const copy = reasonCopy(item.reason);
  const incoming = item.incoming;
  const isPending = mutation.isPending;

  return (
    <div className="flex flex-col gap-gate-20">
      <Banner
        variant={item.reason === "conflict" || item.reason === "duplicate_ref" ? "danger" : "warning"}
        title={copy.label}
        description={copy.description}
      />

      <div className="grid grid-cols-1 gap-gate-20 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Incoming transaction"
            description="Raw SMS forwarded by the fleet."
          />
          <CardBody className="flex flex-col gap-gate-16">
            {incoming ? (
              <>
                <dl className="grid grid-cols-2 gap-gate-16">
                  <KeyValue
                    label="Provider"
                    value={
                      <ProviderBadge
                        provider={incoming.provider}
                        label={providerLabel(incoming.provider)}
                      />
                    }
                  />
                  <KeyValue
                    label="Amount"
                    value={formatBdt(incoming.amount)}
                    mono
                  />
                  <KeyValue
                    label="TrxID"
                    value={
                      <span className="inline-flex items-center gap-gate-4">
                        <span className="font-gate-mono text-gate-mono">
                          {incoming.trx_id}
                        </span>
                        <CopyButton value={incoming.trx_id} label="TrxID" />
                      </span>
                    }
                  />
                  <KeyValue
                    label="Wallet"
                    value={
                      <span className="inline-flex items-center gap-gate-4">
                        <span className="font-gate-mono text-gate-mono">
                          {incoming.wallet_id}
                        </span>
                        <CopyButton value={incoming.wallet_id} label="wallet id" />
                      </span>
                    }
                  />
                  <KeyValue
                    label="Reference (raw)"
                    value={incoming.ref_raw ?? "—"}
                    mono
                  />
                  <KeyValue
                    label="Reference (normalised)"
                    value={incoming.ref_normalized ?? "—"}
                    mono
                  />
                  <KeyValue
                    label="Balance after"
                    value={
                      incoming.balance_after !== null
                        ? formatBdt(incoming.balance_after)
                        : "—"
                    }
                    mono
                  />
                  <KeyValue
                    label="Received"
                    value={formatDateTime(incoming.received_at)}
                  />
                </dl>
                {incoming.flags && incoming.flags.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-gate-8">
                    {incoming.flags.map((flag) => (
                      <StatusPill key={flag} label={flag} tone="warning" />
                    ))}
                  </div>
                ) : null}
                {item.suggested_reference ? (
                  <Banner
                    variant="info"
                    title="Check-character suggestion"
                    description={`${item.suggested_reference} — a suggestion only, never applied automatically.`}
                  />
                ) : null}
              </>
            ) : (
              <LinesSkeleton count={4} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Candidate payments"
            description="Pick the payment this money belongs to."
          />
          <CardBody className="flex flex-col gap-gate-12">
            {candidates.length > 0 ? (
              candidates.map((payment) => (
                <CandidateOption
                  key={payment.id}
                  payment={payment}
                  selected={payment.id === candidateId}
                  onSelect={() => setCandidateId(payment.id)}
                  reference={payment.reference}
                />
              ))
            ) : (
              <p className="text-gate-body text-gate-ink-2">
                No pending payment matches this transaction. Accept it to record an
                unmatched credit, or reject it and send it back to the merchant.
              </p>
            )}

            <Textarea
              label="Resolution note"
              placeholder="Why this decision is correct — kept in the audit log."
              value={note}
              onChange={(event) => setNote(event.target.value)}
              hint="Required when rejecting."
            />

            {error ? (
              <p role="alert" className="text-gate-caption text-gate-danger">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-gate-8">
              <Button
                onClick={() => run("matched")}
                loading={isPending && mutation.variables?.resolution === "matched"}
                disabled={!candidateId}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Match to payment
              </Button>
              <Button
                variant="secondary"
                onClick={() => run("accepted")}
                loading={isPending && mutation.variables?.resolution === "accepted"}
              >
                Accept as-is
              </Button>
              <Button
                variant="danger"
                onClick={() => run("rejected")}
                loading={isPending && mutation.variables?.resolution === "rejected"}
              >
                <XCircle className="size-4" aria-hidden="true" />
                Reject
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                         */
/* -------------------------------------------------------------------------- */

export default function ReviewQueuePage() {
  const query = useQuery({
    queryKey: queryKeys.adminReview,
    queryFn: getAdminReview,
  });

  const cases = query.data ?? [];
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Selection is derived: a selected case that no longer exists falls back to
  // the first open case, and an empty queue selects nothing.
  const effectiveSelectedId = cases.some((item) => item.id === selectedId)
    ? selectedId
    : (cases[0]?.id ?? null);

  const selected = cases.find((item) => item.id === effectiveSelectedId) ?? null;

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Review queue"
        description="Money arrived that the matcher could not place. Every decision is written to the audit log."
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

      {query.isPending ? (
        <TableSkeleton rows={5} columns={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : cases.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-gate-12 py-gate-40 text-center">
            <CheckCircle2
              className="size-8 text-gate-success"
              aria-hidden="true"
            />
            <h2 className="text-gate-h3 font-semibold text-gate-ink">
              Queue is clear
            </h2>
            <p className="max-w-[52ch] text-gate-body text-gate-ink-2">
              Every incoming transaction is matched. Anything ambiguous will show
              up here for a human call.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-gate-20 xl:grid-cols-[minmax(0,340px)_1fr]">
          <Card className="self-start">
            <CardHeader
              title="Open cases"
              description={`${cases.length} awaiting a decision`}
            />
            <CaseList
              cases={cases}
              selectedId={effectiveSelectedId}
              onSelect={setSelectedId}
            />
          </Card>

          <div className="min-w-0">
            {selected ? (
              <CaseDetail key={selected.id} item={selected} />
            ) : (
              <Card>
                <CardBody className="flex flex-col items-center gap-gate-12 py-gate-40 text-center">
                  <AlertTriangle
                    className="size-8 text-gate-warning"
                    aria-hidden="true"
                  />
                  <p className="text-gate-body text-gate-ink-2">
                    Select a case on the left to see the transaction.
                  </p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
