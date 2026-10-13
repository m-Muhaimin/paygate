"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, Send, ShieldOff } from "lucide-react";

import { Banner, Button, DataTable, useToast, WalletDeviceCard } from "@/components/gate";
import {
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  GenericStatus,
  PageHeader,
} from "@/components/app/ui";
import { CardsSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  createPairingCode,
  errorMessage,
  flushDevice,
  getAdminDevices,
  getAdminWallets,
  queryKeys,
  revokeDevice,
  type Device,
  type PairingCode,
  type Wallet,
} from "@/lib/client/query";
import {
  formatBdt,
  formatRelative,
  isLive,
  maskMsisdn,
  providerLabel,
} from "@/components/app/format";

/* -------------------------------------------------------------------------- */
/* Pairing                                                                      */
/* -------------------------------------------------------------------------- */

function useCountdown(expiresAt: string | null): string {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return "";
  const remaining = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now) / 1000)
  );
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return remaining > 0
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : "expired";
}

function PairingCard() {
  const { toast } = useToast();
  const [code, setCode] = React.useState<PairingCode | null>(null);
  const countdown = useCountdown(code?.expires_at ?? null);

  const mutation = useMutation({
    mutationFn: createPairingCode,
    onSuccess: (pairing) => setCode(pairing),
    onError: (error) =>
      toast({
        title: "Could not create a pairing code",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const expired = Boolean(code) && countdown === "expired";

  return (
    <Card>
      <CardHeader
        title="Pair a device"
        description="Enter this one-time code in the PayGate forwarder app."
        actions={
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            <KeyRound className="size-4" aria-hidden="true" />
            Generate code
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-gate-12">
        {code ? (
          expired ? (
            <Banner
              variant="warning"
              title="Code expired"
              description="Generate a new pairing code to continue."
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-gate-12 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-16">
              <div className="flex flex-col gap-gate-4">
                <span className="text-gate-caption text-gate-ink-2">
                  One-time pairing code
                </span>
                <span className="font-gate-mono text-gate-h2 tracking-[0.3em] text-gate-ink">
                  {code.code}
                </span>
                <span className="text-gate-caption text-gate-ink-2">
                  Expires in{" "}
                  <span className="tabular-nums text-gate-ink">{countdown}</span>
                </span>
              </div>
              <CopyButton value={code.code} label="pairing code" />
            </div>
          )
        ) : (
          <p className="text-gate-body text-gate-ink-2">
            Codes are single-use and short-lived. Only devices paired with a code
            can forward SMS for the wallet pool.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Fleet                                                                        */
/* -------------------------------------------------------------------------- */

const PERMISSION_LABELS: Record<string, string> = {
  sms: "SMS access",
  notifications: "Notifications",
  battery_optimisation: "Battery unrestricted",
};

function toPermissions(device: Device) {
  const permissions = device.permissions ?? {};
  const entries = Object.entries(permissions);
  if (entries.length === 0) {
    return [{ label: "Permissions unknown", granted: false }];
  }
  return entries.map(([key, granted]) => ({
    label:
      PERMISSION_LABELS[key] ??
      key
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    granted: Boolean(granted),
  }));
}

export default function FleetPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const devices = useQuery({
    queryKey: queryKeys.adminDevices,
    queryFn: getAdminDevices,
  });
  const wallets = useQuery({
    queryKey: queryKeys.adminWallets,
    queryFn: getAdminWallets,
  });

  const refresh = () => {
    void devices.refetch();
    void wallets.refetch();
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminDevices });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminWallets });
  };

  const revoke = useMutation({
    mutationFn: (id: string) => revokeDevice(id),
    onSuccess: () => {
      toast({ title: "Device revoked", variant: "success" });
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Could not revoke the device",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const flush = useMutation({
    mutationFn: (id: string) => flushDevice(id),
    onSuccess: () => {
      toast({ title: "Flush requested", description: "The queue will drain shortly.", variant: "success" });
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Could not flush the queue",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const walletByDevice = new Map<string, Wallet>();
  for (const wallet of wallets.data ?? []) {
    if (wallet.device_id) walletByDevice.set(wallet.device_id, wallet);
  }

  const allDevices = devices.data ?? [];
  const boundDevices = allDevices.filter(
    (device) => device.status === "active" && walletByDevice.has(device.id)
  );
  const otherDevices = allDevices.filter(
    (device) => !(device.status === "active" && walletByDevice.has(device.id))
  );

  const isPending = devices.isPending || wallets.isPending;
  const isError = devices.isError || wallets.isError;
  const error = devices.error ?? wallets.error;

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Device fleet"
        description="Android forwarders and the wallets they serve. A device is live if it heartbeated within the last 3 minutes."
        actions={
          <Button
            variant="secondary"
            onClick={refresh}
            loading={devices.isFetching || wallets.isFetching}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <PairingCard />

      {isPending ? (
        <CardsSkeleton count={4} />
      ) : isError ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <>
          {boundDevices.length > 0 ? (
            <div className="grid grid-cols-1 gap-gate-20 xl:grid-cols-2">
              {boundDevices.map((device) => {
                const wallet = walletByDevice.get(device.id);
                const online = isLive(device.last_heartbeat_at);
                return (
                  <div key={device.id} className="flex flex-col gap-gate-8">
                    <WalletDeviceCard
                      deviceName={device.name ?? device.model ?? "Unnamed device"}
                      provider={wallet?.provider ?? "bkash"}
                      msisdn={
                        wallet ? maskMsisdn(wallet.msisdn) : "No wallet bound"
                      }
                      online={online}
                      battery={device.battery ?? 0}
                      queueDepth={device.queue_depth}
                      limitUsed={wallet?.today_total ?? 0}
                      limitTotal={wallet?.daily_limit ?? 0}
                      lastHeartbeat={formatRelative(device.last_heartbeat_at)}
                      permissions={toPermissions(device)}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-gate-8 px-gate-4">
                      <span className="text-gate-caption text-gate-ink-2">
                        {wallet
                          ? `${providerLabel(wallet.provider)} · daily limit ${formatBdt(
                              wallet.daily_limit
                            )}`
                          : "No wallet bound"}
                        {device.app_version ? ` · app ${device.app_version}` : ""}
                      </span>
                      <span className="flex items-center gap-gate-8">
                        <Button
                          variant="secondary"
                          onClick={() => flush.mutate(device.id)}
                          loading={flush.isPending && flush.variables === device.id}
                        >
                          <Send className="size-4" aria-hidden="true" />
                          Flush
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => revoke.mutate(device.id)}
                          loading={revoke.isPending && revoke.variables === device.id}
                        >
                          <ShieldOff className="size-4" aria-hidden="true" />
                          Revoke
                        </Button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {boundDevices.length === 0 ? (
            <Card>
              <CardBody>
                <TableEmpty
                  title="No paired devices"
                  description="Generate a pairing code and install the forwarder app on an Android phone."
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Other devices"
              description="Active devices without a bound wallet, plus revoked devices."
            />
            <div className="p-gate-16">
              <DataTable<Device>
                caption="Devices without a bound wallet"
                getRowId={(device) => device.id}
                rows={otherDevices}
                rowHeight={48}
                columns={[
                  {
                    key: "name",
                    header: "Device",
                    render: (device) => (
                      <span className="flex flex-col">
                        <span className="text-gate-body font-medium text-gate-ink">
                          {device.name ?? device.model ?? "Unnamed device"}
                        </span>
                        <span className="font-gate-mono text-gate-caption text-gate-ink-3">
                          {device.id}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (device) => <GenericStatus status={device.status} />,
                  },
                  {
                    key: "heartbeat",
                    header: "Last heartbeat",
                    render: (device) => (
                      <span className="text-gate-caption text-gate-ink-2">
                        {formatRelative(device.last_heartbeat_at)}
                      </span>
                    ),
                  },
                  {
                    key: "queue",
                    header: "Queue",
                    align: "center",
                    render: (device) => device.queue_depth,
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    align: "right",
                    render: (device) =>
                      device.status === "revoked" ? null : (
                        <Button
                          variant="ghost"
                          onClick={() => revoke.mutate(device.id)}
                          loading={revoke.isPending && revoke.variables === device.id}
                        >
                          <ShieldOff className="size-4" aria-hidden="true" />
                          Revoke
                        </Button>
                      ),
                  },
                ]}
                emptyState={
                  <TableEmpty
                    title="Nothing here"
                    description="Every active device has a wallet bound."
                  />
                }
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
