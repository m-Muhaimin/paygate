"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";

import { Button, DataTable, Input } from "@/components/gate";
import { Select } from "@/components/app/form-controls";
import { Drawer } from "@/components/app/drawer";
import {
  Card,
  CardHeader,
  CopyButton,
  KeyValue,
  PageHeader,
  Toolbar,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  getAdminAudit,
  queryKeys,
  type AuditEntry,
  type AuditFilters,
} from "@/lib/client/query";
import { formatDateTime } from "@/components/app/format";

const ENTITY_TYPES = [
  { value: "all", label: "All entities" },
  { value: "payment", label: "Payment" },
  { value: "plan", label: "Plan" },
  { value: "wallet", label: "Wallet" },
  { value: "device", label: "Device" },
  { value: "payout", label: "Payout" },
  { value: "merchant", label: "Merchant" },
  { value: "review", label: "Review case" },
];

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="flex flex-col gap-gate-8">
        <h3 className="text-gate-body font-medium text-gate-ink">{title}</h3>
        <p className="text-gate-caption text-gate-ink-2">No snapshot recorded.</p>
      </div>
    );
  }

  const text = JSON.stringify(value, null, 2);

  return (
    <div className="flex flex-col gap-gate-8">
      <div className="flex items-center justify-between gap-gate-8">
        <h3 className="text-gate-body font-medium text-gate-ink">{title}</h3>
        <CopyButton value={text} label={`${title} JSON`} />
      </div>
      <pre className="max-h-72 overflow-auto rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-12 font-gate-mono text-gate-mono text-gate-ink">
        {text}
      </pre>
    </div>
  );
}

function AuditDrawer({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={Boolean(entry)}
      onClose={onClose}
      title={entry?.action ?? "Audit entry"}
      description={entry ? formatDateTime(entry.created_at) : undefined}
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} type="button">
            Close
          </Button>
        </div>
      }
    >
      {entry ? (
        <div className="flex flex-col gap-gate-20">
          <dl className="grid grid-cols-2 gap-gate-16">
            <KeyValue label="Actor" value={entry.actor ?? "system"} mono />
            <KeyValue label="Entity type" value={entry.entity_type ?? "—"} />
            <KeyValue label="Entity ID" value={entry.entity_id ?? "—"} mono />
            <KeyValue label="IP" value={entry.ip ?? "—"} mono />
          </dl>
          <JsonBlock title="Before" value={entry.before} />
          <JsonBlock title="After" value={entry.after} />
        </div>
      ) : null}
    </Drawer>
  );
}

export default function AuditLogPage() {
  const [draftQ, setDraftQ] = React.useState("");
  const [draftActor, setDraftActor] = React.useState("");
  const [draftAction, setDraftAction] = React.useState("");
  const [draftEntity, setDraftEntity] = React.useState("all");
  const [filters, setFilters] = React.useState<AuditFilters>({});
  const [entry, setEntry] = React.useState<AuditEntry | null>(null);

  const query = useQuery({
    queryKey: queryKeys.adminAudit(filters),
    queryFn: () => getAdminAudit(filters),
  });

  const rows = query.data ?? [];
  const filtered = Object.keys(filters).length > 0;

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters({
      q: draftQ.trim() || undefined,
      actor: draftActor.trim() || undefined,
      action: draftAction.trim() || undefined,
      entity_type: draftEntity === "all" ? undefined : draftEntity,
    });
  };

  const reset = () => {
    setDraftQ("");
    setDraftActor("");
    setDraftAction("");
    setDraftEntity("all");
    setFilters({});
  };

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Audit log"
        description="Every privileged action, who took it, and the before/after state."
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

      <form onSubmit={apply} aria-label="Audit filters">
        <Toolbar>
          <div className="min-w-48 flex-1">
            <Input
              label="Search"
              placeholder="Entity id, action or reference"
              value={draftQ}
              onChange={(event) => setDraftQ(event.target.value)}
            />
          </div>
          <div className="min-w-44">
            <Input
              label="Actor"
              placeholder="admin@paygate"
              value={draftActor}
              onChange={(event) => setDraftActor(event.target.value)}
            />
          </div>
          <div className="min-w-44">
            <Input
              label="Action"
              placeholder="payout.approve"
              value={draftAction}
              onChange={(event) => setDraftAction(event.target.value)}
            />
          </div>
          <div className="min-w-44">
            <Select
              label="Entity"
              value={draftEntity}
              onChange={(event) => setDraftEntity(event.target.value)}
              options={ENTITY_TYPES}
            />
          </div>
          <div className="flex items-center gap-gate-8">
            <Button type="submit">
              <Search className="size-4" aria-hidden="true" />
              Apply
            </Button>
            <Button variant="ghost" type="button" onClick={reset}>
              Reset
            </Button>
          </div>
        </Toolbar>
      </form>

      <Card>
        <CardHeader
          title="Events"
          description={
            rows.length > 0
              ? `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
              : undefined
          }
        />
        <div className="p-gate-16">
          {query.isPending ? (
            <TableSkeleton rows={6} columns={5} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <DataTable<AuditEntry>
              caption="Audit entries"
              getRowId={(item) => item.id}
              rows={rows}
              rowHeight={48}
              onRowClick={setEntry}
              columns={[
                {
                  key: "created_at",
                  header: "When",
                  render: (item) => (
                    <span className="whitespace-nowrap text-gate-caption text-gate-ink-2">
                      {formatDateTime(item.created_at)}
                    </span>
                  ),
                },
                {
                  key: "actor",
                  header: "Actor",
                  render: (item) => (
                    <span className="font-gate-mono text-gate-caption text-gate-ink">
                      {item.actor ?? "system"}
                    </span>
                  ),
                },
                {
                  key: "action",
                  header: "Action",
                  render: (item) => (
                    <span className="font-gate-mono text-gate-mono text-gate-ink">
                      {item.action}
                    </span>
                  ),
                },
                {
                  key: "entity",
                  header: "Entity",
                  render: (item) => (
                    <span className="flex flex-col">
                      <span className="text-gate-caption text-gate-ink-2">
                        {item.entity_type ?? "—"}
                      </span>
                      {item.entity_id ? (
                        <span className="font-gate-mono text-gate-caption text-gate-ink-3">
                          {item.entity_id}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "ip",
                  header: "IP",
                  align: "right",
                  render: (item) => (
                    <span className="font-gate-mono text-gate-caption text-gate-ink-2">
                      {item.ip ?? "—"}
                    </span>
                  ),
                },
              ]}
              emptyState={
                <TableEmpty
                  title={filtered ? "No matching events" : "No audit entries"}
                  description={
                    filtered
                      ? "Try widening the filters — audit events are never deleted."
                      : "Privileged actions will show up here as they happen."
                  }
                  action={
                    filtered ? (
                      <Button variant="secondary" onClick={reset} type="button">
                        Reset filters
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          )}
        </div>
      </Card>

      <AuditDrawer entry={entry} onClose={() => setEntry(null)} />
    </div>
  );
}
