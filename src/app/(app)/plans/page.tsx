"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { z } from "zod";

import { Banner, Button, DataTable, Input, useToast } from "@/components/gate";
import { Switch, Textarea } from "@/components/app/form-controls";
import { Drawer } from "@/components/app/drawer";
import { Card, GenericStatus, PageHeader } from "@/components/app/ui";
import { TableSkeleton } from "@/components/app/skeleton";
import { ErrorState, TableEmpty } from "@/components/app/states";
import {
  createPlan,
  errorMessage,
  getPlans,
  queryKeys,
  updatePlan,
  type Plan,
  type PlanInput,
} from "@/lib/client/query";
import {
  formatBdt,
  formatDate,
  paisaFromInput,
  paisaToInput,
} from "@/components/app/format";

/* -------------------------------------------------------------------------- */
/* Form                                                                         */
/* -------------------------------------------------------------------------- */

const planSchema = z
  .object({
    name: z.string().trim().min(1, "Give the plan a name."),
    amountTk: z.string(),
    external_sku: z.string(),
    open_amount: z.boolean(),
    minTk: z.string(),
    maxTk: z.string(),
    description: z.string(),
  })
  .superRefine((value, ctx) => {
    if (!value.open_amount) {
      const amount = paisaFromInput(value.amountTk);
      if (amount === null || amount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amountTk"],
          message: "Enter the fixed amount in Tk.",
        });
      }
      return;
    }

    const min = paisaFromInput(value.minTk);
    const max = paisaFromInput(value.maxTk);
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTk"],
        message: "Maximum must be at least the minimum.",
      });
    }
  });

type PlanFormValues = z.infer<typeof planSchema>;

const EMPTY_FORM: PlanFormValues = {
  name: "",
  amountTk: "",
  external_sku: "",
  open_amount: false,
  minTk: "",
  maxTk: "",
  description: "",
};

function planToForm(plan: Plan): PlanFormValues {
  return {
    name: plan.name,
    amountTk: paisaToInput(plan.amount),
    external_sku: plan.external_sku ?? "",
    open_amount: plan.open_amount,
    minTk: paisaToInput(plan.min_amount),
    maxTk: paisaToInput(plan.max_amount),
    description: "",
  };
}

function toPlanInput(values: PlanFormValues): PlanInput {
  const open = values.open_amount;
  return {
    name: values.name.trim(),
    amount: open ? null : paisaFromInput(values.amountTk),
    external_sku: values.external_sku.trim() || null,
    open_amount: open,
    min_amount: open ? paisaFromInput(values.minTk) : null,
    max_amount: open ? paisaFromInput(values.maxTk) : null,
  };
}

function PlanFormDrawer({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan: Plan | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isEdit = Boolean(plan);

  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: EMPTY_FORM,
  });

  React.useEffect(() => {
    if (!open) return;
    form.reset(plan ? planToForm(plan) : EMPTY_FORM);
  }, [open, plan, form]);

  const openAmount = form.watch("open_amount");
  const amountTk = form.watch("amountTk");

  const mutation = useMutation({
    mutationFn: async (values: PlanFormValues) => {
      const input = toPlanInput(values);
      return plan ? updatePlan(plan.id, input) : createPlan(input);
    },
    onSuccess: (saved) => {
      toast({
        title: plan ? `Plan saved as v${saved.version}` : "Plan created",
        description: plan
          ? "Existing payments keep the old version; new checkouts use this one."
          : `${saved.name} is ready to accept payments.`,
        variant: "success",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Could not save the plan",
        description: errorMessage(error),
        variant: "danger",
      });
    },
  });

  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${plan?.name}` : "New plan"}
      description={
        isEdit
          ? `Currently v${plan?.version}. Saving creates v${(plan?.version ?? 1) + 1}.`
          : "Plans describe what a customer is paying for."
      }
      footer={
        <div className="flex justify-end gap-gate-8">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {isEdit ? "Save as new version" : "Create plan"}
          </Button>
        </div>
      }
    >
      <form className="flex flex-col gap-gate-20" onSubmit={submit} noValidate>
        {isEdit ? (
          <Banner
            variant="info"
            title="Versioning"
            description="Editing a plan never mutates the published version. A new version is created and the previous one is archived."
          />
        ) : null}

        <Input
          label="Plan name"
          required
          placeholder="Monthly subscription"
          error={form.formState.errors.name?.message}
          {...form.register("name")}
        />

        <div className="flex flex-col gap-gate-12">
          <Switch
            checked={openAmount}
            onCheckedChange={(checked) =>
              form.setValue("open_amount", checked, { shouldValidate: true })
            }
            label="Customer chooses the amount"
            description="Leave off for a fixed price, on for a min/max range."
          />
          {openAmount ? (
            <div className="grid grid-cols-2 gap-gate-12">
              <Input
                label="Minimum (Tk)"
                inputMode="decimal"
                placeholder="0.00"
                error={form.formState.errors.minTk?.message}
                {...form.register("minTk")}
              />
              <Input
                label="Maximum (Tk)"
                inputMode="decimal"
                placeholder="0.00"
                error={form.formState.errors.maxTk?.message}
                {...form.register("maxTk")}
              />
            </div>
          ) : (
            <Input
              label="Amount (Tk)"
              required
              inputMode="decimal"
              placeholder="1,200.00"
              error={form.formState.errors.amountTk?.message}
              hint={
                paisaFromInput(amountTk ?? "") !== null
                  ? `Stored as ${paisaFromInput(amountTk ?? "")} paisa`
                  : "Amounts are stored as integer paisa."
              }
              {...form.register("amountTk")}
            />
          )}
        </div>

        <Input
          label="External SKU"
          placeholder="optional-plan-key"
          hint="Your own identifier, echoed back on the payment."
          {...form.register("external_sku")}
        />

        <Textarea
          label="Internal note"
          placeholder="Optional note for your team"
          {...form.register("description")}
        />
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                         */
/* -------------------------------------------------------------------------- */

export default function PlansPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Plan | null>(null);

  const query = useQuery({ queryKey: queryKeys.plans, queryFn: getPlans });

  const archive = useMutation({
    mutationFn: (id: string) => updatePlan(id, { status: "archived" }),
    onSuccess: () => {
      toast({ title: "Plan archived", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: queryKeys.plans });
    },
    onError: (error) =>
      toast({
        title: "Could not archive the plan",
        description: errorMessage(error),
        variant: "danger",
      }),
  });

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setDrawerOpen(true);
  };

  const plans = query.data ?? [];

  return (
    <div className="flex flex-col gap-gate-20">
      <PageHeader
        title="Plans"
        description="Fixed-price or customer-chosen amounts. Editing a plan publishes a new version."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" />
            New plan
          </Button>
        }
      />

      {query.isPending ? (
        <TableSkeleton rows={5} columns={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable<Plan>
          caption="Pricing plans"
          getRowId={(plan) => plan.id}
          rows={plans}
          rowHeight={56}
          columns={[
            {
              key: "name",
              header: "Plan",
              render: (plan) => (
                <span className="flex flex-col">
                  <span className="text-gate-body font-medium text-gate-ink">
                    {plan.name}
                  </span>
                  {plan.external_sku ? (
                    <span className="font-gate-mono text-gate-caption text-gate-ink-3">
                      {plan.external_sku}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              mono: true,
              render: (plan) =>
                plan.open_amount
                  ? `${formatBdt(plan.min_amount ?? 0)} – ${formatBdt(
                      plan.max_amount ?? 0
                    )}`
                  : formatBdt(plan.amount ?? 0),
            },
            {
              key: "version",
              header: "Version",
              align: "center",
              render: (plan) => (
                <span className="font-gate-mono text-gate-mono text-gate-ink-2">
                  v{plan.version}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (plan) => <GenericStatus status={plan.status} />,
            },
            {
              key: "created_at",
              header: "Created",
              align: "right",
              render: (plan) => (
                <span className="text-gate-caption text-gate-ink-2">
                  {formatDate(plan.created_at)}
                </span>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              render: (plan) => (
                <span className="inline-flex items-center gap-gate-8">
                  <Button
                    variant="secondary"
                    onClick={() => openEdit(plan)}
                    aria-label={`Edit ${plan.name}`}
                  >
                    Edit
                  </Button>
                  {plan.status === "active" ? (
                    <Button
                      variant="ghost"
                      onClick={() => archive.mutate(plan.id)}
                      loading={archive.isPending && archive.variables === plan.id}
                      aria-label={`Archive ${plan.name}`}
                    >
                      Archive
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
          emptyState={
            <TableEmpty
              title="No plans yet"
              description="Create a plan so the API can build payment requests against it."
              action={
                <Button onClick={openCreate}>
                  <Plus className="size-4" aria-hidden="true" />
                  New plan
                </Button>
              }
            />
          }
        />
      )}

      {plans.length > 0 ? (
        <Card className="p-gate-16">
          <p className="text-gate-caption text-gate-ink-2">
            {plans.length} plan{plans.length === 1 ? "" : "s"} · editing publishes a new
            version and archives the previous one.
          </p>
        </Card>
      ) : null}

      <PlanFormDrawer
        open={drawerOpen}
        plan={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
