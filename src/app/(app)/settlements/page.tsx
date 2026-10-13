"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { z } from "zod";

import { Button, DataTable, Input, useToast } from "@/components/gate";
import { Select } from "@/components/app/form-controls";
import { Card, CardBody, CardHeader, GenericStatus, KeyValue, PageHeader } from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  createPayout,
  errorMessage,
  getBalance,
  getPayouts,
  getSettlements,
  queryKeys,
  settlementsExportUrl,
  type Payout,
  type Settlement,
} from "@/lib/client/query";
import {
  MIN_PAYOUT_DISPLAY,
  MIN_PAYOUT_PAISA,
  formatBdt,
  formatDate,
  paisaFromInput,
  providerLabel,
} from "@/components/app/format";

const payoutSchema = z
  .object({
    amountTk: z.string(),
    rail: z.enum(["bank", "mfs"]),
    bank_name: z.string(),
    provider: z.enum(["bkash", "nagad", "rocket"]),
    account_no: z.string().trim().min(1, "Enter the destination account number."),
    holder: z.string().trim().min(1, "Enter the account holder name."),
  })
  .superRefine((value, ctx) => {
    const paisa = paisaFromInput(value.amountTk);
    if (paisa === null || paisa <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountTk"],
        message: "Enter the payout amount in Tk.",
      });
    } else if (paisa < MIN_PAYOUT_PAISA) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountTk"],
        message: `Minimum payout is ${MIN_PAYOUT_DISPLAY}.`,
      });
    }
    if (value.rail === "bank" && !value.bank_name.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bank_name"],
        message: "Enter the bank name.",
      });
    }
  });

type PayoutFormValues = z.infer<typeof payoutSchema>;

const DEFAULT_FORM: PayoutFormValues = {
  amountTk: "",
  rail: "bank",
  bank_name: "",
  provider: "bkash",
  account_no: "",
  holder: "",
};

function PayoutRequestCard({ available }: { available: number | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<PayoutFormValues>({
    resolver: zodResolver(payoutSchema),
    defaultValues: DEFAULT_FORM,
  });

  const rail = form.watch("rail");
  const amountTk = form.watch("amountTk");
  const amountPaisa = paisaFromInput(amountTk ?? "");
  const overAvailable =
    available !== null && amountPaisa !== null && amountPaisa > available;

  const mutation = useMutation({
    mutationFn: (values: PayoutFormValues) =>
      createPayout({
        amount: paisaFromInput(values.amountTk) ?? 0,
        rail: values.rail,
        destination: {
          account_no: values.account_no.trim(),
          holder: values.holder.trim(),
          ...(values.rail === "bank"
            ? { bank_name: values.bank_name.trim() }
            : { provider: values.provider }),
        },
      }),
    onSuccess: () => {
      toast({
        title: "Payout requested",
        description: "An admin will approve it before the money moves.",
        variant: "success",
      });
      form.reset(DEFAULT_FORM);
      void queryClient.invalidateQueries({ queryKey: queryKeys.payouts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance });
    },
    onError: (error) =>
      toast({
        title: "Could not request the payout",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  return (
    <Card>
      <CardHeader
        title="Request a payout"
        description="Bank account or MFS wallet. Minimum Tk 1,000."
      />
      <CardBody>
        <form
          className="flex flex-col gap-gate-16"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <Input
            label="Amount (Tk)"
            required
            inputMode="decimal"
            placeholder="1,000.00"
            error={form.formState.errors.amountTk?.message}
            hint={
              amountPaisa !== null
                ? overAvailable
                  ? "More than your available balance."
                  : `Stored as ${amountPaisa} paisa`
                : `Minimum ${MIN_PAYOUT_DISPLAY}`
            }
            {...form.register("amountTk")}
          />

          <Select
            label="Rail"
            value={rail}
            onChange={(event) =>
              form.setValue("rail", event.target.value as "bank" | "mfs")
            }
            options={[
              { value: "bank", label: "Bank account" },
              { value: "mfs", label: "MFS wallet" },
            ]}
          />

          {rail === "bank" ? (
            <Input
              label="Bank name"
              error={form.formState.errors.bank_name?.message}
              {...form.register("bank_name")}
            />
          ) : (
            <Select
              label="Wallet"
              value={form.watch("provider")}
              onChange={(event) =>
                form.setValue(
                  "provider",
                  event.target.value as "bkash" | "nagad" | "rocket"
                )
              }
              options={[
                { value: "bkash", label: "bKash" },
                { value: "nagad", label: "Nagad" },
                { value: "rocket", label: "Rocket" },
              ]}
            />
          )}

          <Input
            label={rail === "bank" ? "Account number" : "Wallet number"}
            required
            inputMode="numeric"
            error={form.formState.errors.account_no?.message}
            {...form.register("account_no")}
          />

          <Input
            label="Account holder"
            required
            error={form.formState.errors.holder?.message}
            {...form.register("holder")}
          />

          <div className="flex justify-end">
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={overAvailable}
            >
              Request payout
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default function SettlementsPage() {
  const balance = useQuery({ queryKey: queryKeys.balance, queryFn: getBalance });
  const settlements = useQuery({
    queryKey: queryKeys.settlements,
    queryFn: getSettlements,
  });
  const payouts = useQuery({ queryKey: queryKeys.payouts, queryFn: getPayouts });

  const settlementRows = settlements.data ?? [];
  const payoutRows = payouts.data ?? [];

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Settlements"
        description="What you've earned, your statements, and payouts to your bank or wallet."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = settlementsExportUrl({ format: "csv" });
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      <Card>
        <CardHeader title="Balance" description="All amounts in Tk." />
        <CardBody>
          {balance.isPending ? (
            <div className="grid grid-cols-2 gap-gate-16 md:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-12 animate-pulse rounded-gate-input bg-gate-surface-2"
                />
              ))}
            </div>
          ) : balance.isError ? (
            <ErrorState error={balance.error} onRetry={() => void balance.refetch()} />
          ) : balance.data ? (
            <dl className="grid grid-cols-2 gap-gate-16 md:grid-cols-5">
              <KeyValue
                label="Available"
                value={formatBdt(balance.data.available)}
                mono
              />
              <KeyValue
                label="Pending payouts"
                value={formatBdt(balance.data.pending_payouts)}
                mono
              />
              <KeyValue
                label="Lifetime gross"
                value={formatBdt(balance.data.lifetime_gross)}
                mono
              />
              <KeyValue
                label="Lifetime fees"
                value={formatBdt(balance.data.lifetime_fees)}
                mono
              />
              <KeyValue
                label="Lifetime net"
                value={formatBdt(balance.data.lifetime_net)}
                mono
              />
            </dl>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-gate-20 xl:grid-cols-[1fr_minmax(0,420px)]">
        <Card className="self-start">
          <CardHeader
            title="Statements"
            description="Settled periods, newest first."
            actions={
              <Button
                variant="ghost"
                onClick={() => void settlements.refetch()}
                loading={settlements.isFetching}
              >
                Refresh
              </Button>
            }
          />
          <div className="p-gate-16">
            {settlements.isPending ? (
              <TableSkeleton rows={5} columns={5} />
            ) : settlements.isError ? (
              <ErrorState
                error={settlements.error}
                onRetry={() => void settlements.refetch()}
              />
            ) : (
              <DataTable<Settlement>
                caption="Settlement statements"
                getRowId={(row) => row.id}
                rows={settlementRows}
                rowHeight={48}
                columns={[
                  {
                    key: "period",
                    header: "Period",
                    render: (row) =>
                      `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`,
                  },
                  {
                    key: "gross",
                    header: "Gross",
                    align: "right",
                    mono: true,
                    render: (row) => formatBdt(row.gross_amount),
                  },
                  {
                    key: "fee",
                    header: "Fee",
                    align: "right",
                    mono: true,
                    render: (row) => formatBdt(row.fee_amount),
                  },
                  {
                    key: "net",
                    header: "Net",
                    align: "right",
                    mono: true,
                    render: (row) => formatBdt(row.net_amount),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => <GenericStatus status={row.status} />,
                  },
                ]}
                emptyState={
                  <TableEmpty
                    title="No statements yet"
                    description="Statements appear after your first settlement period closes."
                  />
                }
              />
            )}
          </div>
        </Card>

        <PayoutRequestCard available={balance.data?.available ?? null} />
      </div>

      <Card>
        <CardHeader
          title="Payout history"
          description="Requested, approved and paid payouts."
        />
        <div className="p-gate-16">
          {payouts.isPending ? (
            <TableSkeleton rows={4} columns={5} />
          ) : payouts.isError ? (
            <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} />
          ) : (
            <DataTable<Payout>
              caption="Payout history"
              getRowId={(row) => row.id}
              rows={payoutRows}
              rowHeight={48}
              columns={[
                {
                  key: "created_at",
                  header: "Requested",
                  render: (row) => formatDate(row.created_at),
                },
                {
                  key: "amount",
                  header: "Amount",
                  align: "right",
                  mono: true,
                  render: (row) => formatBdt(row.amount),
                },
                {
                  key: "rail",
                  header: "Rail",
                  render: (row) => (row.rail === "bank" ? "Bank" : "MFS"),
                },
                {
                  key: "destination",
                  header: "Destination",
                  mono: true,
                  render: (row) => {
                    const dest = row.destination;
                    if (!dest) return "—";
                    const label =
                      row.rail === "bank"
                        ? dest.bank_name ?? "Bank"
                        : dest.provider
                          ? providerLabel(dest.provider)
                          : "Wallet";
                    return (
                      <span className="flex flex-col">
                        <span>{label}</span>
                        <span className="text-gate-caption text-gate-ink-3">
                          {dest.account_no ?? "—"}
                        </span>
                      </span>
                    );
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => <GenericStatus status={row.status} />,
                },
              ]}
              emptyState={
                <TableEmpty
                  title="No payouts yet"
                  description="Request a payout above once your balance clears Tk 1,000."
                />
              }
            />
          )}
        </div>
      </Card>
    </div>
  );
}
