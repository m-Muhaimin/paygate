"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, RotateCcw, Send } from "lucide-react";

import {
  Banner,
  Button,
  DataTable,
  Input,
  useToast,
} from "@/components/gate";
import { Drawer } from "@/components/app/drawer";
import { Switch } from "@/components/app/form-controls";
import {
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  GenericStatus,
  PageHeader,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  createApiKey,
  errorMessage,
  getApiKeys,
  getWebhookDeliveries,
  queryKeys,
  resendWebhookDelivery,
  revokeApiKey,
  rotateWebhookSecret,
  type ApiKey,
  type CreatedApiKey,
  type WebhookDelivery,
} from "@/lib/client/query";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative } from "@/components/app/format";

/* -------------------------------------------------------------------------- */
/* Key creation                                                                 */
/* -------------------------------------------------------------------------- */

function CreateKeyDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [label, setLabel] = React.useState("");
  const [mode, setMode] = React.useState<"live" | "test">("live");
  const [created, setCreated] = React.useState<CreatedApiKey | null>(null);

  // Clear the form each time the drawer is opened (see "adjusting state when
  // props change" — state is reset during render, not in an effect).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLabel("");
      setMode("live");
      setCreated(null);
    }
  }

  const mutation = useMutation({
    mutationFn: () => createApiKey({ label: label.trim() || "Untitled key", mode }),
    onSuccess: (key) => {
      setCreated(key);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (error) =>
      toast({
        title: "Could not create the key",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={created ? "Copy your new key" : "Create API key"}
      description={
        created
          ? "This is the only time the full key is shown."
          : "Keys are hashed at rest — you can never view them again."
      }
      footer={
        <div className="flex justify-end">
          {created ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
              Create key
            </Button>
          )}
        </div>
      }
    >
      {created ? (
        <div className="flex flex-col gap-gate-16">
          <Banner
            variant="warning"
            title="Store this key now"
            description="It will not be shown again. Anyone with this key can create payments."
          />
          <div className="flex items-center justify-between gap-gate-12 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-12">
            <code className="break-all font-gate-mono text-gate-mono text-gate-ink">
              {created.plaintext}
            </code>
            <CopyButton value={created.plaintext} label="API key" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-gate-20">
          <Input
            label="Label"
            placeholder="Production server"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Switch
            checked={mode === "test"}
            onCheckedChange={(test) => setMode(test ? "test" : "live")}
            label="Test mode"
            description="Test keys are prefixed sk_test_ and never move real money."
          />
        </div>
      )}
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Code samples                                                                 */
/* -------------------------------------------------------------------------- */

const CURL_SAMPLE = `curl https://api.paygate.test/v1/payments \\
  -H "Authorization: Bearer sk_live_…" \\
  -H "Idempotency-Key: order_1042" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plan_id": "plan_abc123",
    "order_id": "order_1042",
    "provider": "bkash",
    "callback_url": "https://shop.example/webhooks/paygate"
  }'`;

const JS_SAMPLE = `const res = await fetch("https://api.paygate.test/v1/payments", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.PAYGATE_KEY}\`,
    "Idempotency-Key": order.id,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    plan_id: "plan_abc123",
    order_id: order.id,
    provider: "bkash",
  }),
});

const payment = await res.json();
// { id, amount, reference, wallet, pay_url, expires_at, status }`;

function CodeSamples() {
  const [tab, setTab] = React.useState<"curl" | "js">("curl");
  const code = tab === "curl" ? CURL_SAMPLE : JS_SAMPLE;

  return (
    <Card>
      <CardHeader
        title="Create a payment"
        description="POST /v1/payments with a merchant key and an Idempotency-Key."
        actions={
          <div className="flex items-center gap-gate-4 rounded-gate-input bg-gate-surface-2 p-gate-2">
            {(["curl", "js"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
                className={cn(
                  "rounded-gate-input px-gate-12 py-gate-6 text-gate-caption font-medium transition-colors duration-[120ms] ease-gate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
                  tab === value
                    ? "bg-gate-surface text-gate-ink"
                    : "text-gate-ink-2 hover:text-gate-ink"
                )}
              >
                {value === "curl" ? "cURL" : "JavaScript"}
              </button>
            ))}
          </div>
        }
      />
      <div className="relative">
        <pre className="overflow-x-auto p-gate-20 font-gate-mono text-gate-mono leading-relaxed text-gate-ink">
          {code}
        </pre>
        <div className="absolute right-gate-12 top-gate-12">
          <CopyButton value={code} label="code sample" />
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                         */
/* -------------------------------------------------------------------------- */

export default function DevelopersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [webhookSecret, setWebhookSecret] = React.useState<string | null>(null);

  const keys = useQuery({ queryKey: queryKeys.apiKeys, queryFn: getApiKeys });
  const deliveries = useQuery({
    queryKey: queryKeys.webhookDeliveries,
    queryFn: getWebhookDeliveries,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      toast({ title: "Key revoked", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
    onError: (error) =>
      toast({
        title: "Could not revoke the key",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const rotate = useMutation({
    mutationFn: rotateWebhookSecret,
    onSuccess: (result) => {
      setWebhookSecret(result.secret);
      toast({
        title: "Webhook secret rotated",
        description: "The old secret stays valid for 24 hours.",
        variant: "success",
      });
    },
    onError: (error) =>
      toast({
        title: "Could not rotate the secret",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendWebhookDelivery(id),
    onSuccess: () => {
      toast({ title: "Delivery queued for resend", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webhookDeliveries });
    },
    onError: (error) =>
      toast({
        title: "Could not resend",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const keyRows = keys.data ?? [];
  const deliveryRows = deliveries.data ?? [];

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Developers"
        description="API keys, webhook delivery and integration samples."
      />

      <div className="grid grid-cols-1 gap-gate-20 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="API keys"
            description="Hashed at rest. Create shows the key exactly once."
            actions={
              <Button onClick={() => setDrawerOpen(true)}>
                <Plus className="size-4" aria-hidden="true" />
                New key
              </Button>
            }
          />
          <div className="p-gate-16">
            {keys.isPending ? (
              <TableSkeleton rows={3} columns={4} />
            ) : keys.isError ? (
              <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
            ) : (
              <DataTable<ApiKey>
                caption="API keys"
                getRowId={(row) => row.id}
                rows={keyRows}
                rowHeight={56}
                columns={[
                  {
                    key: "label",
                    header: "Label",
                    render: (row) => (
                      <span className="flex flex-col">
                        <span className="text-gate-body font-medium text-gate-ink">
                          {row.label ?? "Untitled key"}
                        </span>
                        {row.revoked_at ? (
                          <span className="text-gate-caption text-gate-ink-3">
                            Revoked {formatRelative(row.revoked_at)}
                          </span>
                        ) : (
                          <span className="text-gate-caption text-gate-ink-3">
                            Last used{" "}
                            {row.last_used_at
                              ? formatRelative(row.last_used_at)
                              : "never"}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "masked_key",
                    header: "Key",
                    mono: true,
                    render: (row) => (
                      <span className="inline-flex items-center gap-gate-4">
                        {row.masked_key}
                        <CopyButton value={row.masked_key} label="masked key" />
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => (
                      <GenericStatus
                        status={row.revoked_at ? "revoked" : "active"}
                      />
                    ),
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    align: "right",
                    render: (row) =>
                      row.revoked_at ? null : (
                        <Button
                          variant="ghost"
                          onClick={() => revoke.mutate(row.id)}
                          loading={revoke.isPending && revoke.variables === row.id}
                        >
                          Revoke
                        </Button>
                      ),
                  },
                ]}
                emptyState={
                  <TableEmpty
                    title="No API keys"
                    description="Create a key to start integrating PayGate."
                  />
                }
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Webhook secret"
            description="Signs every outbound webhook (PayGate-Signature)."
          />
          <CardBody className="flex flex-col gap-gate-16">
            <p className="text-gate-body text-gate-ink-2">
              Rotating issues a new secret and keeps the previous one valid for 24
              hours so in-flight retries still verify.
            </p>
            {webhookSecret ? (
              <div className="flex flex-col gap-gate-8">
                <Banner
                  variant="warning"
                  title="Copy the new secret now"
                  description="It will not be shown again."
                />
                <div className="flex items-center justify-between gap-gate-12 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-12">
                  <code className="break-all font-gate-mono text-gate-mono text-gate-ink">
                    {webhookSecret}
                  </code>
                  <CopyButton value={webhookSecret} label="webhook secret" />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-gate-12 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-12">
                <code className="font-gate-mono text-gate-mono text-gate-ink-2">
                  ••••••••••••••••••••••••••
                </code>
              </div>
            )}
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => rotate.mutate()}
                loading={rotate.isPending}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Rotate secret
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Webhook inspector"
          description="Delivery attempts for payment.paid, payment.expired, payment.needs_review and payment.cancelled."
          actions={
            <Button
              variant="ghost"
              onClick={() => void deliveries.refetch()}
              loading={deliveries.isFetching}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
          }
        />
        <div className="p-gate-16">
          {deliveries.isPending ? (
            <TableSkeleton rows={4} columns={6} />
          ) : deliveries.isError ? (
            <ErrorState
              error={deliveries.error}
              onRetry={() => void deliveries.refetch()}
            />
          ) : (
            <DataTable<WebhookDelivery>
              caption="Webhook deliveries"
              getRowId={(row) => row.id}
              rows={deliveryRows}
              rowHeight={48}
              columns={[
                {
                  key: "event_type",
                  header: "Event",
                  mono: true,
                  render: (row) => row.event_type,
                },
                {
                  key: "event_id",
                  header: "Event ID",
                  mono: true,
                  render: (row) => row.event_id,
                },
                {
                  key: "attempts",
                  header: "Attempts",
                  align: "center",
                  render: (row) => row.attempts,
                },
                {
                  key: "last_status_code",
                  header: "Last code",
                  align: "center",
                  mono: true,
                  render: (row) => row.last_status_code ?? "—",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => <GenericStatus status={row.status} />,
                },
                {
                  key: "created_at",
                  header: "When",
                  align: "right",
                  render: (row) => (
                    <span className="text-gate-caption text-gate-ink-2">
                      {formatDateTime(row.created_at)}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  align: "right",
                  render: (row) => (
                    <Button
                      variant="ghost"
                      onClick={() => resend.mutate(row.id)}
                      loading={resend.isPending && resend.variables === row.id}
                    >
                      <Send className="size-4" aria-hidden="true" />
                      Resend
                    </Button>
                  ),
                },
              ]}
              emptyState={
                <TableEmpty
                  title="No webhook deliveries"
                  description="Deliveries appear here once your endpoint is receiving events."
                />
              }
            />
          )}
        </div>
      </Card>

      <CodeSamples />

      <CreateKeyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
