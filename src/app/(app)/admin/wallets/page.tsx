"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { z } from "zod";

import { Button, DataTable, Input, useToast } from "@/components/gate";
import { Select } from "@/components/app/form-controls";
import { Drawer } from "@/components/app/drawer";
import {
  Card,
  CardHeader,
  CopyButton,
  GenericStatus,
  PageHeader,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  createAdminWallet,
  errorMessage,
  getAdminWallets,
  queryKeys,
  updateAdminWallet,
  type Wallet,
  type WalletInput,
} from "@/lib/client/query";
import {
  formatBdt,
  maskMsisdn,
  paisaFromInput,
  paisaToInput,
  providerLabel,
} from "@/components/app/format";

const walletSchema = z.object({
  provider: z.enum(["bkash", "nagad", "rocket"]),
  msisdn: z
    .string()
    .trim()
    .regex(/^01\d{9}$/, "Use an 11-digit number starting with 01."),
  holder_name: z.string(),
  daily_limit: z.string(),
  monthly_limit: z.string(),
  concurrency_cap: z.string(),
  status: z.enum(["active", "draining", "disabled"]),
});

type WalletFormValues = z.infer<typeof walletSchema>;

const EMPTY_FORM: WalletFormValues = {
  provider: "bkash",
  msisdn: "",
  holder_name: "",
  daily_limit: "50000",
  monthly_limit: "",
  concurrency_cap: "3",
  status: "active",
};

function toForm(wallet: Wallet): WalletFormValues {
  return {
    provider: wallet.provider,
    msisdn: wallet.msisdn,
    holder_name: wallet.holder_name ?? "",
    daily_limit: paisaToInput(wallet.daily_limit),
    monthly_limit: paisaToInput(wallet.monthly_limit),
    concurrency_cap: String(wallet.concurrency_cap),
    status: wallet.status,
  };
}

function toInput(values: WalletFormValues): WalletInput {
  return {
    provider: values.provider,
    msisdn: values.msisdn.trim(),
    holder_name: values.holder_name.trim() || null,
    daily_limit: paisaFromInput(values.daily_limit) ?? 0,
    monthly_limit: paisaFromInput(values.monthly_limit),
    concurrency_cap: Number(values.concurrency_cap) || 1,
    status: values.status,
  };
}

function WalletDrawer({
  open,
  wallet,
  onClose,
}: {
  open: boolean;
  wallet: Wallet | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<WalletFormValues>({
    resolver: zodResolver(walletSchema),
    defaultValues: EMPTY_FORM,
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset(wallet ? toForm(wallet) : EMPTY_FORM);
  }, [open, wallet, form]);

  const mutation = useMutation({
    mutationFn: (values: WalletFormValues) =>
      wallet
        ? updateAdminWallet(wallet.id, toInput(values))
        : createAdminWallet(toInput(values)),
    onSuccess: () => {
      toast({ title: wallet ? "Wallet updated" : "Wallet added", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminWallets });
      onClose();
    },
    onError: (error) =>
      toast({
        title: "Could not save the wallet",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={wallet ? `Edit ${maskMsisdn(wallet.msisdn)}` : "Add wallet"}
      description="Wallets are the receiving numbers the router rotates between."
      footer={
        <div className="flex justify-end gap-gate-8">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={form.handleSubmit((values) => mutation.mutate(values))}
            loading={mutation.isPending}
          >
            {wallet ? "Save changes" : "Add wallet"}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-gate-20"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        noValidate
      >
        <Select
          label="Provider"
          value={form.watch("provider")}
          onChange={(event) =>
            form.setValue("provider", event.target.value as WalletFormValues["provider"])
          }
          options={[
            { value: "bkash", label: "bKash" },
            { value: "nagad", label: "Nagad" },
            { value: "rocket", label: "Rocket" },
          ]}
        />
        <Input
          label="Wallet number"
          required
          inputMode="numeric"
          placeholder="01712345678"
          error={form.formState.errors.msisdn?.message}
          {...form.register("msisdn")}
        />
        <Input label="Holder name" {...form.register("holder_name")} />
        <Input
          label="Daily limit (Tk)"
          inputMode="decimal"
          error={form.formState.errors.daily_limit?.message}
          hint="Rotated out of the pool once reached."
          {...form.register("daily_limit")}
        />
        <Input
          label="Monthly limit (Tk)"
          inputMode="decimal"
          hint="Leave blank for no monthly ceiling."
          {...form.register("monthly_limit")}
        />
        <Input
          label="Concurrency cap"
          inputMode="numeric"
          hint="Max simultaneous pending payments on this number."
          {...form.register("concurrency_cap")}
        />
        <Select
          label="Status"
          value={form.watch("status")}
          onChange={(event) =>
            form.setValue("status", event.target.value as WalletFormValues["status"])
          }
          options={[
            { value: "active", label: "Active" },
            { value: "draining", label: "Draining (finish in-flight)" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </form>
    </Drawer>
  );
}

export default function WalletsPage() {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Wallet | null>(null);

  const query = useQuery({
    queryKey: queryKeys.adminWallets,
    queryFn: getAdminWallets,
  });

  const wallets = query.data ?? [];
  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (wallet: Wallet) => {
    setEditing(wallet);
    setDrawerOpen(true);
  };

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Wallet pool"
        description="Receiving numbers, their limits and how much they've taken today."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void query.refetch()}
              loading={query.isFetching}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              Add wallet
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          title="All wallets"
          description={`${wallets.length} number${wallets.length === 1 ? "" : "s"} in the pool.`}
        />
        <div className="p-gate-16">
          {query.isPending ? (
            <TableSkeleton rows={5} columns={6} />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <DataTable<Wallet>
              caption="Wallet pool"
              getRowId={(wallet) => wallet.id}
              rows={wallets}
              rowHeight={56}
              onRowClick={openEdit}
              columns={[
                {
                  key: "msisdn",
                  header: "Wallet",
                  render: (wallet) => (
                    <span className="inline-flex items-center gap-gate-4">
                      <span className="font-gate-mono text-gate-mono text-gate-ink">
                        {maskMsisdn(wallet.msisdn)}
                      </span>
                      <CopyButton value={wallet.msisdn} label="wallet number" />
                    </span>
                  ),
                },
                {
                  key: "provider",
                  header: "Provider",
                  render: (wallet) => providerLabel(wallet.provider),
                },
                {
                  key: "device",
                  header: "Device",
                  render: (wallet) =>
                    wallet.device_id ? (
                      <span className="font-gate-mono text-gate-caption text-gate-ink-2">
                        {wallet.device_id}
                      </span>
                    ) : (
                      <span className="text-gate-caption text-gate-ink-3">
                        Unbound
                      </span>
                    ),
                },
                {
                  key: "usage",
                  header: "Today / daily limit",
                  align: "right",
                  mono: true,
                  render: (wallet) =>
                    `${formatBdt(wallet.today_total)} / ${formatBdt(wallet.daily_limit)}`,
                },
                {
                  key: "concurrency",
                  header: "Cap",
                  align: "center",
                  render: (wallet) => wallet.concurrency_cap,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (wallet) => <GenericStatus status={wallet.status} />,
                },
              ]}
              emptyState={
                <TableEmpty
                  title="No wallets in the pool"
                  description="Add a receiving number before the router can assign payments."
                  action={
                    <Button onClick={openCreate}>
                      <Plus className="size-4" aria-hidden="true" />
                      Add wallet
                    </Button>
                  }
                />
              }
            />
          )}
        </div>
      </Card>

      <WalletDrawer
        open={drawerOpen}
        wallet={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
