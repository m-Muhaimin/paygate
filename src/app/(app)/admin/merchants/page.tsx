"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, ShieldX } from "lucide-react";

import { Banner, Button, DataTable, useToast } from "@/components/gate";
import { Textarea } from "@/components/app/form-controls";
import { Drawer } from "@/components/app/drawer";
import {
  Card,
  CardHeader,
  GenericStatus,
  PageHeader,
  StatusPill,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  decideKyb,
  errorMessage,
  getAdminMerchants,
  queryKeys,
  type AdminMerchant,
} from "@/lib/client/query";
import { cn } from "@/lib/utils";
import { formatBdt, formatDate } from "@/components/app/format";

type KybDecision = "approved" | "rejected";

const RISK_TONE: Record<string, "neutral" | "warning" | "danger"> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
};

function KybDrawer({
  merchant,
  decision,
  onClose,
}: {
  merchant: AdminMerchant | null;
  decision: KybDecision | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Reset the decision form whenever a new merchant is opened. Following the
  // "adjusting state when props change" pattern: the previous merchant is
  // tracked and state is reset during render, so the model stays authoritative.
  const [prevMerchant, setPrevMerchant] = React.useState(merchant);
  if (merchant !== prevMerchant) {
    setPrevMerchant(merchant);
    setNote("");
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!merchant || !decision) throw new Error("Nothing to decide");
      return decideKyb(merchant.id, decision, note.trim() || undefined);
    },
    onSuccess: () => {
      toast({
        title: decision === "approved" ? "KYB approved" : "KYB rejected",
        description:
          decision === "approved"
            ? "The merchant can now take live payments."
            : "The merchant has been notified and can resubmit.",
        variant: decision === "approved" ? "success" : "info",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminMerchants });
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
    if (decision === "rejected" && !note.trim()) {
      setError("A reason is required when rejecting KYB.");
      return;
    }
    setError(null);
    mutation.mutate();
  };

  return (
    <Drawer
      open={Boolean(merchant && decision)}
      onClose={onClose}
      title={decision === "rejected" ? "Reject KYB" : "Approve KYB"}
      description={merchant?.name}
      footer={
        <div className="flex justify-end gap-gate-8">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant={decision === "rejected" ? "danger" : "primary"}
            onClick={submit}
            loading={mutation.isPending}
          >
            {decision === "rejected" ? "Reject merchant" : "Approve merchant"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-gate-16">
        <Banner
          variant="info"
          title="Written to the audit log"
          description="KYB decisions record your identity, the timestamp and this note."
        />
        <Textarea
          label={decision === "rejected" ? "Reason" : "Note (optional)"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            decision === "rejected"
              ? "What is missing from the submission?"
              : "Any conditions attached to the approval."
          }
          hint={decision === "rejected" ? "Required when rejecting." : undefined}
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

export default function AdminMerchantsPage() {
  const [merchant, setMerchant] = React.useState<AdminMerchant | null>(null);
  const [decision, setDecision] = React.useState<KybDecision | null>(null);

  const query = useQuery({
    queryKey: queryKeys.adminMerchants,
    queryFn: getAdminMerchants,
  });

  const rows = query.data ?? [];

  const decide = (target: AdminMerchant, nextDecision: KybDecision) => {
    setMerchant(target);
    setDecision(nextDecision);
  };

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Merchants"
        description="Onboarding and KYB decisions across the platform."
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
          title="All merchants"
          description={
            rows.length > 0
              ? `${rows.filter((row) => row.kyb_status !== "approved").length} awaiting KYB`
              : undefined
          }
        />
        <div className="p-gate-16">
          {query.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <DataTable<AdminMerchant>
              caption="Merchants"
              getRowId={(row) => row.id}
              rows={rows}
              rowHeight={56}
              columns={[
                {
                  key: "name",
                  header: "Merchant",
                  render: (row) => (
                    <span className="flex flex-col">
                      <span className="text-gate-body font-medium text-gate-ink">
                        {row.name}
                      </span>
                      <span className="font-gate-mono text-gate-caption text-gate-ink-3">
                        {row.id}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Account",
                  render: (row) => <GenericStatus status={row.status} />,
                },
                {
                  key: "kyb",
                  header: "KYB",
                  render: (row) => <GenericStatus status={row.kyb_status} />,
                },
                {
                  key: "risk",
                  header: "Risk",
                  render: (row) => (
                    <StatusPill
                      label={row.risk_tier}
                      tone={RISK_TONE[row.risk_tier] ?? "neutral"}
                    />
                  ),
                },
                {
                  key: "fee",
                  header: "Fee",
                  align: "right",
                  mono: true,
                  render: (row) => `${(row.fee_rate_bps / 100).toFixed(2)}%`,
                },
                {
                  key: "gross",
                  header: "Lifetime gross",
                  align: "right",
                  mono: true,
                  render: (row) =>
                    row.lifetime_gross !== undefined
                      ? formatBdt(row.lifetime_gross)
                      : "—",
                },
                {
                  key: "created_at",
                  header: "Joined",
                  align: "right",
                  render: (row) => (
                    <span className="text-gate-caption text-gate-ink-2">
                      {formatDate(row.created_at)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "KYB decision",
                  align: "right",
                  render: (row) =>
                    row.kyb_status === "approved" ? (
                      <span
                        className={cn(
                          "text-gate-caption text-gate-ink-3"
                        )}
                      >
                        Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-gate-8">
                        <Button
                          onClick={() => decide(row, "approved")}
                          aria-label={`Approve KYB for ${row.name}`}
                        >
                          <ShieldCheck className="size-4" aria-hidden="true" />
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => decide(row, "rejected")}
                          aria-label={`Reject KYB for ${row.name}`}
                        >
                          <ShieldX className="size-4" aria-hidden="true" />
                          Reject
                        </Button>
                      </span>
                    ),
                },
              ]}
              emptyState={
                <TableEmpty
                  title="No merchants"
                  description="New sign-ups appear here for KYB review."
                />
              }
            />
          )}
        </div>
      </Card>

      <KybDrawer
        merchant={merchant}
        decision={decision}
        onClose={() => {
          setMerchant(null);
          setDecision(null);
        }}
      />
    </div>
  );
}
