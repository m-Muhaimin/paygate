"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { Button, DataTable, Input, useToast } from "@/components/gate";
import { Select } from "@/components/app/form-controls";
import {
  Card,
  CardBody,
  CardHeader,
  GenericStatus,
  KeyValue,
  PageHeader,
  StatusPill,
} from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  errorMessage,
  getMe,
  getTeam,
  queryKeys,
  updateMe,
  type Merchant,
  type TeamMember,
} from "@/lib/client/query";
import { formatDate } from "@/components/app/format";

const profileSchema = z
  .object({
    name: z.string().trim().min(1, "Business name is required."),
    rail: z.enum(["bank", "mfs"]),
    bank_name: z.string(),
    provider: z.enum(["bkash", "nagad", "rocket"]),
    account_no: z.string(),
    holder: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.rail === "bank" && !value.bank_name.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bank_name"],
        message: "Enter the bank name.",
      });
    }
    if (!value.account_no.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["account_no"],
        message: "Enter the payout account number.",
      });
    }
    if (!value.holder.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["holder"],
        message: "Enter the account holder name.",
      });
    }
  });

type ProfileFormValues = z.infer<typeof profileSchema>;

function toForm(merchant: Merchant): ProfileFormValues {
  const account = merchant.payout_account;
  const rail: "bank" | "mfs" =
    account?.type ?? (account?.provider ? "mfs" : "bank");
  return {
    name: merchant.name,
    rail,
    bank_name: account?.bank_name ?? "",
    provider: account?.provider ?? "bkash",
    account_no: account?.account_no ?? "",
    holder: account?.holder ?? "",
  };
}

function ProfileCard({ merchant }: { merchant: Merchant }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toForm(merchant),
  });

  React.useEffect(() => {
    form.reset(toForm(merchant));
  }, [merchant, form]);

  const rail = form.watch("rail");

  const mutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      updateMe({
        name: values.name.trim(),
        payout_account: {
          type: values.rail,
          account_no: values.account_no.trim(),
          holder: values.holder.trim(),
          ...(values.rail === "bank"
            ? { bank_name: values.bank_name.trim() }
            : { provider: values.provider }),
        },
      }),
    onSuccess: () => {
      toast({ title: "Profile saved", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (error) =>
      toast({
        title: "Could not save your profile",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const dirty = form.formState.isDirty;

  return (
    <Card>
      <CardHeader
        title="Business profile"
        description="Shown on payment pages and used for payouts."
        actions={
          merchant.status ? <GenericStatus status={merchant.status} /> : null
        }
      />
      <CardBody>
        <form
          className="flex flex-col gap-gate-20"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <Input
            label="Business name"
            required
            error={form.formState.errors.name?.message}
            {...form.register("name")}
          />

          <div className="grid grid-cols-2 gap-gate-16 md:grid-cols-4">
            <KeyValue label="Merchant ID" value={merchant.id} mono />
            <KeyValue
              label="Fee rate"
              value={`${(merchant.fee_rate_bps / 100).toFixed(2)}%`}
              mono
            />
            <KeyValue label="Risk tier" value={merchant.risk_tier} />
            <KeyValue label="Joined" value={formatDate(merchant.created_at)} />
          </div>

          <div className="flex flex-col gap-gate-16 border-t border-gate-border pt-gate-16">
            <h3 className="text-gate-h3 font-semibold text-gate-ink">
              Payout account
            </h3>
            <Select
              label="Rail"
              value={rail}
              onChange={(event) =>
                form.setValue("rail", event.target.value as "bank" | "mfs", {
                  shouldDirty: true,
                })
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
                    event.target.value as "bkash" | "nagad" | "rocket",
                    { shouldDirty: true }
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
              error={form.formState.errors.account_no?.message}
              {...form.register("account_no")}
            />
            <Input
              label="Account holder"
              error={form.formState.errors.holder?.message}
              {...form.register("holder")}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={mutation.isPending} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function TeamCard() {
  const query = useQuery({ queryKey: queryKeys.team, queryFn: getTeam });
  const team = query.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Team & access"
        description="Who can sign in to this merchant account."
      />
      <div className="p-gate-16">
        {query.isPending ? (
          <TableSkeleton rows={3} columns={4} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <DataTable<TeamMember>
            caption="Team members"
            getRowId={(member) => member.id}
            rows={team}
            rowHeight={48}
            columns={[
              {
                key: "email",
                header: "Member",
                render: (member) => (
                  <span className="text-gate-body text-gate-ink">
                    {member.email ?? "Pending invite"}
                  </span>
                ),
              },
              {
                key: "role",
                header: "Role",
                render: (member) => <StatusPill label={member.role} />,
              },
              {
                key: "2fa",
                header: "2FA",
                render: (member) =>
                  member.two_factor_enabled ? (
                    <GenericStatus status="active" label="Enabled" />
                  ) : (
                    <GenericStatus status="pending" label="Not set" />
                  ),
              },
              {
                key: "created_at",
                header: "Added",
                align: "right",
                render: (member) => (
                  <span className="text-gate-caption text-gate-ink-2">
                    {formatDate(member.created_at)}
                  </span>
                ),
              },
            ]}
            emptyState={
              <TableEmpty
                title="No team members"
                description="Invite teammates so they can operate the dashboard."
              />
            }
          />
        )}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: getMe });

  return (
    <div className="flex flex-col gap-gate-24">
      <PageHeader
        title="Settings"
        description="Business profile, payout account and team access."
      />

      {me.isPending ? (
        <Card>
          <CardBody>
            <div className="flex flex-col gap-gate-16">
              <div className="h-10 w-1/3 animate-pulse rounded-gate-input bg-gate-surface-2" />
              <div className="h-10 w-full animate-pulse rounded-gate-input bg-gate-surface-2" />
              <div className="h-10 w-2/3 animate-pulse rounded-gate-input bg-gate-surface-2" />
            </div>
          </CardBody>
        </Card>
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      ) : me.data ? (
        <ProfileCard merchant={me.data} />
      ) : null}

      <TeamCard />
    </div>
  );
}
