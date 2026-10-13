"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleSlash2,
  CircleX,
  Clock,
  Hourglass,
  Lock,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";

import { CopyButton } from "@/components/app/copy-button";
import { DrawnCheck } from "@/components/app/drawn-check";
import { PayLinkInvalid } from "@/components/app/pay-link-invalid";
import {
  Banner,
  Button,
  Input,
  ReferenceChip,
  StatusChip,
  type PaymentStatus as ChipStatus,
} from "@/components/gate";
import {
  CONFIRM_MAX_ATTEMPTS,
  confirmPay,
  getPay,
  isTerminalStatus,
  isValidTrxId,
  payKeys,
  type ConfirmResult,
  type PayLink,
  type Provider,
} from "@/lib/client/api";
import {
  ApiClientError,
  isApiClientError,
  QueryProvider,
  type PaymentStatus,
} from "@/lib/client/query";
import { formatBDT, formatCountdown } from "@/lib/client/format";
import {
  DICTIONARIES,
  PROVIDER_LABELS,
  type Lang,
  type PayCopy,
} from "@/lib/client/i18n";
import { cn } from "@/lib/utils";

/** Server-enforced lockout duration after too many confirm attempts (§B.1). */
const LOCKOUT_MS = 15 * 60_000;

/** Same-origin channel the popup SDK listens on (see `public/paygate.js`). */
const PARENT_SOURCE = "paygate-pay";

/**
 * Payment-status poll cadence. `GET /v1/pay/:id` is rate limited to 10 req/min/IP
 * (`enforceRateLimit(req, "pay-page", 10, 60)` in
 * `src/app/api/v1/pay/[id]/route.ts`), so the previous 3s poll (~20 req/min)
 * self-429'd after ~30s and dropped the customer into the error state mid-payment.
 * 8s = 7.5 req/min keeps a safe margin under the limit while still feeling live.
 */
const PAY_POLL_INTERVAL_MS = 8000;

/** Ceiling for the transient-failure poll backoff (doubles from the base). */
const PAY_POLL_MAX_INTERVAL_MS = 30_000;

const PROVIDER_DOT: Record<Provider, string> = {
  bkash: "bg-gate-provider-bkash",
  nagad: "bg-gate-provider-nagad",
  rocket: "bg-gate-provider-rocket",
};

export function PayClient({ paymentId }: { paymentId: string }) {
  return (
    <QueryProvider>
      <PaySurface paymentId={paymentId} />
    </QueryProvider>
  );
}

/** Best-effort parent origin for embedded postMessage (falls back to `*`). */
function parentTargetOrigin(): string {
  try {
    const loc = window.location as unknown as {
      ancestorOrigins?: { length: number; [index: number]: string };
    };
    if (loc.ancestorOrigins && loc.ancestorOrigins.length > 0) {
      return loc.ancestorOrigins[0] || "*";
    }
  } catch {
    /* ancestorOrigins is Chromium-only; fall through. */
  }
  return "*";
}

function isTrxUsedError(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  if (error.status === 409) return true;
  const code = error.code.toLowerCase();
  return /used|duplicate|already/.test(code);
}

function isLockoutError(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  if (error.status === 429) return true;
  const code = error.code.toLowerCase();
  return /many_attempts|too_many|locked|lockout/.test(code);
}

function isExpiredError(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  if (error.status === 410) return true;
  return /expired/.test(error.code.toLowerCase());
}

/**
 * A poll failure that must NOT flip the pay page into its terminal error state:
 * the route's own 429 (`too_many_requests`) and transport-level network failures
 * (`status === 0`). Real 4xx/5xx (bad/expired link, server failure) stay terminal.
 */
function isTransientPollError(error: unknown): boolean {
  if (!isApiClientError(error)) return false;
  return error.status === 429 || error.status === 0;
}

/**
 * Resolve the status to render. A locally-known terminal (or "confirming")
 * result from `POST /confirm` wins until the slower GET poll catches up.
 */
function pickStatus(
  server: PaymentStatus | undefined,
  local: PaymentStatus | null,
): PaymentStatus | undefined {
  if (!server) return local ?? undefined;
  if (isTerminalStatus(server)) return server;
  if (local === "confirming") return "confirming";
  if (local && isTerminalStatus(local)) return local;
  return server;
}

/** Where "Back to Shop" should send the customer, if the merchant set one. */
function resolutionTarget(
  data: PayLink,
  status: PaymentStatus | undefined,
): string | null {
  if (status === "paid" || status === "needs_review") return data.success_url;
  if (status === "expired" || status === "cancelled") return data.cancel_url;
  return null;
}

function PaySurface({ paymentId }: { paymentId: string }) {
  const queryClient = useQueryClient();
  const [lang, setLang] = React.useState<Lang>("en");
  const [stage, setStage] = React.useState<"initial" | "ready">("initial");
  const [trxId, setTrxId] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [lockUntil, setLockUntil] = React.useState<number | null>(null);
  const [confirmPhase, setConfirmPhase] = React.useState<PaymentStatus | null>(
    null,
  );
  const [pollDelay, setPollDelay] = React.useState(PAY_POLL_INTERVAL_MS);
  const [lastPollErrorAt, setLastPollErrorAt] = React.useState(0);
  const t = DICTIONARIES[lang];

  const query = useQuery<PayLink, ApiClientError>({
    queryKey: payKeys.detail(paymentId),
    queryFn: ({ signal }) => getPay(paymentId, signal),
    refetchInterval: (q) =>
      isTerminalStatus(q.state.data?.status) ? false : pollDelay,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (!isApiClientError(error)) return failureCount < 2;
      // 404 is terminal; a 429 must not be hammered with tight retries — the
      // interval backoff below recovers it instead (see `pollDelay`).
      if (error.status === 404 || error.status === 429) return false;
      return failureCount < 2;
    },
  });

  /* Escalate the poll cadence while a transient failure (429 / offline) persists,
     and reset it on the next success. Adjusted during render — React's "derive
     state from previous renders" pattern — so it stays in lock-step with the
     query's own updates without an effect. A terminal failure never lands here:
     the render below sends it to the error state instead. */
  if (query.isError && isTransientPollError(query.error)) {
    if (query.errorUpdatedAt !== lastPollErrorAt) {
      setLastPollErrorAt(query.errorUpdatedAt);
      setPollDelay((delay) => Math.min(delay * 2, PAY_POLL_MAX_INTERVAL_MS));
    }
  } else if (query.isSuccess && pollDelay !== PAY_POLL_INTERVAL_MS) {
    setPollDelay(PAY_POLL_INTERVAL_MS);
    setLastPollErrorAt(0);
  }

  const confirm = useMutation<ConfirmResult, ApiClientError, string>({
    mutationFn: (value) => confirmPay(paymentId, value),
    retry: 0,
    onSuccess: (result) => {
      setConfirmPhase(result.status);
      void queryClient.invalidateQueries({
        queryKey: payKeys.detail(paymentId),
      });
    },
    onError: (error) => {
      if (isLockoutError(error)) setLockUntil(Date.now() + LOCKOUT_MS);
      void queryClient.invalidateQueries({
        queryKey: payKeys.detail(paymentId),
      });
    },
  });

  const data = query.data;
  const status = pickStatus(data?.status, confirmPhase);
  const attemptsRemaining =
    typeof data?.attempts_remaining === "number"
      ? data.attempts_remaining
      : CONFIRM_MAX_ATTEMPTS;
  const showLockout = lockUntil !== null || attemptsRemaining <= 0;

  /* --- Embedded popup mode: relay terminal events to the parent SDK ------- */
  const embedRef = React.useRef(false);
  React.useEffect(() => {
    embedRef.current = window.parent !== window;
  }, []);

  const lastEventRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!embedRef.current || !status) return;
    const event =
      status === "paid"
        ? "paid"
        : status === "needs_review"
          ? "needs_review"
          : status === "expired" || status === "cancelled"
            ? "expired"
            : null;
    if (!event || lastEventRef.current === event) return;
    lastEventRef.current = event;
    window.parent.postMessage(
      {
        source: PARENT_SOURCE,
        event,
        payment_id: paymentId,
        status,
      },
      parentTargetOrigin(),
    );
  }, [status, paymentId]);

  const announce =
    status === "paid"
      ? t.paidAnnounce
      : status === "expired"
        ? t.expiredTitle
        : status === "cancelled"
          ? t.cancelledTitle
          : status === "needs_review"
            ? t.reviewTitle
            : status === "confirming"
              ? t.confirmingTitle
              : confirm.isPending
                ? t.verifyingTitle
                : "";

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stage !== "ready" || confirm.isPending) return;
    const trimmed = trxId.trim();
    if (!isValidTrxId(trimmed)) {
      setLocalError(t.trxInvalid);
      return;
    }
    setLocalError(null);
    lastEventRef.current = null;
    setConfirmPhase(null);
    confirm.mutate(trimmed);
  };

  const handleTrxRetry = () => {
    confirm.reset();
    setTrxId("");
    setLocalError(null);
    setStage("ready");
  };

  const handleLockRetry = () => {
    setLockUntil(null);
    setLocalError(null);
    void query.refetch();
  };

  /* --- Panel ------------------------------------------------------------- */

  /* A transient poll failure (429 / offline) keeps the last-known state on
     screen and keeps polling with backoff instead of dead-ending the customer. */
  const transientPollFailure =
    query.isError && isTransientPollError(query.error);

  let content: React.ReactNode;
  if (query.isPending) {
    content = <LoadingSkeleton label={t.loadingLabel} />;
  } else if (query.isError && isNotFound(query.error)) {
    content = (
      <PayLinkInvalid
        title={t.invalidTitle}
        description={t.invalidBody}
        homeLabel={t.invalidHome}
      />
    );
  } else if (query.isError && !transientPollFailure) {
    content = (
      <div className="py-gate-16">
        <Banner
          variant="danger"
          title={t.errorTitle}
          description={query.error.message}
          action={
            <Button
              variant="secondary"
              size="md"
              onClick={() => void query.refetch()}
            >
              {t.errorRetry}
            </Button>
          }
        />
      </div>
    );
  } else if (!data) {
    content = <LoadingSkeleton label={t.loadingLabel} />;
  } else {
    let body: React.ReactNode;
    if (status === "paid") {
      body = (
        <PaidPanel
          data={data}
          t={t}
          orderId={confirm.data?.payment?.order_id ?? null}
          target={resolutionTarget(data, status)}
        />
      );
    } else if (status === "needs_review") {
      body = (
        <ReviewPanel
          data={data}
          t={t}
          lang={lang}
          reason={
            confirmPhase === "needs_review"
              ? confirm.data?.review_reason ?? data.review_reason
              : data.review_reason
          }
          received={
            typeof confirm.data?.payment?.received_amount === "number"
              ? confirm.data.payment.received_amount
              : null
          }
          target={resolutionTarget(data, status)}
        />
      );
    } else if (status === "expired") {
      body = <ExpiredPanel target={resolutionTarget(data, status)} t={t} />;
    } else if (status === "cancelled") {
      body = (
        <TerminalPanel
          icon={
            <CircleX className="size-6 text-gate-danger" aria-hidden="true" />
          }
          title={t.cancelledTitle}
          body={t.cancelledBody}
          action={
            <BackToShopButton target={resolutionTarget(data, status)} t={t} />
          }
        />
      );
    } else if (status === "confirming") {
      body = <ConfirmingPanel t={t} />;
    } else {
      body = (
        <CheckoutPanel
          data={data}
          t={t}
          lang={lang}
          stage={stage}
          trxId={trxId}
          localError={localError}
          submitting={confirm.isPending}
          attemptsRemaining={attemptsRemaining}
          locked={showLockout}
          lockUntil={lockUntil}
          trxUsed={confirm.isError && isTrxUsedError(confirm.error)}
          expiredError={confirm.isError && isExpiredError(confirm.error)}
          genericError={
            confirm.isError &&
            !isTrxUsedError(confirm.error) &&
            !isExpiredError(confirm.error) &&
            !isLockoutError(confirm.error)
              ? confirm.error.message || t.trxGenericError
              : null
          }
          onStart={() => setStage("ready")}
          onTrxChange={(value) => {
            setTrxId(value);
            if (localError) setLocalError(null);
          }}
          onSubmit={handleSubmit}
          onTrxRetry={handleTrxRetry}
          onLockRetry={handleLockRetry}
        />
      );
    }

    content = (
      <PaymentCard
        data={data}
        t={t}
        lang={lang}
        chip={toChipStatus(status ?? data.status)}
      >
        {body}
      </PaymentCard>
    );
  }

  return (
    <div
      lang={lang}
      className={cn(
        "flex min-h-dvh flex-col bg-gate-bg text-gate-ink",
        lang === "bn" && "font-gate-bn",
      )}
    >
      <header className="mx-auto flex w-full max-w-[26rem] items-center justify-between gap-gate-12 px-gate-16 py-gate-16">
        <BrandMark />
        <LanguageToggle lang={lang} onChange={setLang} t={t} />
      </header>

      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col px-gate-16 pb-gate-40">
        <span role="status" aria-live="polite" className="sr-only">
          {announce}
        </span>
        {transientPollFailure ? (
          <p
            role="status"
            className="mb-gate-12 flex items-center justify-center gap-gate-8 rounded-gate-input bg-gate-surface-2 px-gate-12 py-gate-8 text-gate-caption text-gate-ink-2"
          >
            <Clock className="size-4 shrink-0" aria-hidden="true" />
            {t.confirmingTitle}
          </p>
        ) : null}
        {content}
      </main>

      <footer className="mx-auto w-full max-w-[26rem] px-gate-16 pb-gate-24">
        <p className="flex items-center justify-center gap-gate-8 text-gate-caption text-gate-ink-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          {t.secureNote}
        </p>
      </footer>

      {confirm.isPending && !isTerminalStatus(status) ? (
        <VerifyingOverlay t={t} />
      ) : null}
    </div>
  );
}

function isNotFound(error: unknown): error is ApiClientError {
  return isApiClientError(error) && error.status === 404;
}

/* -------------------------------------------------------------------------- */
/* Checkout (initial / ready / lockout / used)                                 */
/* -------------------------------------------------------------------------- */

interface CheckoutPanelProps {
  data: PayLink;
  t: PayCopy;
  lang: Lang;
  stage: "initial" | "ready";
  trxId: string;
  localError: string | null;
  submitting: boolean;
  attemptsRemaining: number;
  locked: boolean;
  lockUntil: number | null;
  trxUsed: boolean;
  expiredError: boolean;
  genericError: string | null;
  onStart: () => void;
  onTrxChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onTrxRetry: () => void;
  onLockRetry: () => void;
}

function CheckoutPanel({
  data,
  t,
  lang,
  stage,
  trxId,
  localError,
  submitting,
  attemptsRemaining,
  locked,
  lockUntil,
  trxUsed,
  expiredError,
  genericError,
  onStart,
  onTrxChange,
  onSubmit,
  onTrxRetry,
  onLockRetry,
}: CheckoutPanelProps) {
  const wallet = data.wallet;
  const ready = stage === "ready";
  const valueValid = isValidTrxId(trxId);
  const showAttempts =
    ready && !trxUsed && attemptsRemaining < CONFIRM_MAX_ATTEMPTS;

  return (
    <div className="flex flex-col">
      <h2 className="text-gate-h2 font-semibold text-gate-ink">
        {t.waitingTitle}
      </h2>
      <p className="mt-gate-4 max-w-[40ch] text-gate-body text-gate-ink-2">
        {t.waitingIntro}
      </p>

      {/* Wallet the customer must send money to. */}
      <div className="mt-gate-20 rounded-gate-input bg-gate-surface-2 p-gate-16">
        {wallet ? (
          <>
            <p className="text-gate-caption font-medium text-gate-ink-2">
              {t.sendTo(PROVIDER_LABELS[wallet.provider])}
            </p>
            <div className="mt-gate-8 flex items-center justify-between gap-gate-8">
              <span className="font-gate-mono text-gate-h2 font-semibold tabular-nums break-all text-gate-ink">
                {wallet.number}
              </span>
              <CopyButton
                value={wallet.number}
                label={`${t.copyLabel}: ${wallet.number}`}
                copiedLabel={t.copiedLabel}
              />
            </div>
            {wallet.holder_name ? (
              <p className="mt-gate-8 text-gate-caption text-gate-ink-2">
                {t.holderLabel}:{" "}
                <span className="text-gate-ink">{wallet.holder_name}</span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-gate-body text-gate-ink-2">
            {t.walletUnavailable}
          </p>
        )}
      </div>

      {/* Reference — the single accented element on this screen. */}
      <div className="mt-gate-24 flex flex-col items-center gap-gate-8 text-center">
        <p className="text-gate-caption font-medium text-gate-ink-2">
          {t.referenceLabel}
        </p>
        <ReferenceChip reference={data.reference} label={t.referenceLabel} />
        <p className="max-w-[34ch] text-gate-caption text-gate-ink-2">
          {t.referenceHelp}
        </p>
        <p className="flex max-w-[36ch] items-start justify-center gap-gate-4 text-gate-caption text-gate-ink-2">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0 text-gate-warning"
            aria-hidden="true"
          />
          <span>{t.referenceWarning}</span>
        </p>
      </div>

      {data.expires_at ? (
        <div className="mt-gate-24">
          <Countdown
            expiresAt={data.expires_at}
            lang={lang}
            label={t.countdownLabel}
            expiredLabel={t.countdownExpired}
            minutesRemaining={t.minutesRemaining}
            lessThanMinute={t.lessThanMinute}
          />
        </div>
      ) : null}

      {/* Confirm flow. */}
      <section className="mt-gate-20 rounded-gate-input border border-gate-border bg-gate-surface-2 p-gate-16">
        <h3 className="text-gate-h3 font-semibold text-gate-ink">
          {t.trxTitle}
        </h3>

        {trxUsed ? (
          <TrxUsedPanel t={t} onRetry={onTrxRetry} />
        ) : expiredError ? (
          <div className="mt-gate-12">
            <TerminalPanel
              icon={
                <CircleSlash2
                  className="size-6 text-gate-ink-2"
                  aria-hidden="true"
                />
              }
              title={t.expiredTitle}
              body={t.expiredBody}
            />
          </div>
        ) : locked ? (
          <LockoutPanel
            t={t}
            lang={lang}
            until={lockUntil}
            serverLocked={attemptsRemaining <= 0}
            onRetry={onLockRetry}
          />
        ) : (
          <>
            <p className="mt-gate-4 max-w-[44ch] text-gate-caption text-gate-ink-2">
              {t.confirmHelp}
            </p>
            <form
              onSubmit={onSubmit}
              className="mt-gate-12 flex flex-col gap-gate-12"
              noValidate
            >
              <Input
                label={t.trxLabel}
                name="trx_id"
                value={trxId}
                onChange={(event) => onTrxChange(event.target.value)}
                placeholder={t.trxPlaceholder}
                error={localError ?? genericError ?? undefined}
                hint={showAttempts ? t.attemptsLeft(attemptsRemaining) : undefined}
                disabled={!ready}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-gate-mono tabular-nums"
              />
              {ready ? (
                <Button
                  type="submit"
                  loading={submitting}
                  disabled={!valueValid}
                  fullWidth
                  size="lg"
                >
                  {t.confirmCta}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  size="lg"
                  onClick={onStart}
                >
                  {t.trxStart}
                </Button>
              )}
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function TrxUsedPanel({ t, onRetry }: { t: PayCopy; onRetry: () => void }) {
  return (
    <div className="mt-gate-12 flex flex-col items-center gap-gate-12 text-center">
      <span className="grid size-14 place-items-center rounded-gate-pill bg-gate-danger/10">
        <CircleX className="size-6 text-gate-danger" aria-hidden="true" />
      </span>
      <p className="text-gate-h3 font-semibold text-gate-ink">
        {t.trxUsedTitle}
      </p>
      <p className="max-w-[38ch] text-gate-body text-gate-ink-2">
        {t.trxUsedBody}
      </p>
      <Button variant="secondary" fullWidth onClick={onRetry}>
        {t.trxUsedRetry}
      </Button>
    </div>
  );
}

function LockoutPanel({
  t,
  lang,
  until,
  serverLocked,
  onRetry,
}: {
  t: PayCopy;
  lang: Lang;
  until: number | null;
  serverLocked: boolean;
  onRetry: () => void;
}) {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, []);

  const remaining = until !== null && now !== null ? Math.max(0, until - now) : null;
  const counting = remaining !== null && remaining > 0;

  return (
    <div className="mt-gate-12 flex flex-col items-center gap-gate-12 text-center">
      <span className="grid size-14 place-items-center rounded-gate-pill bg-gate-warning/10">
        <Lock className="size-6 text-gate-warning" aria-hidden="true" />
      </span>
      <p className="text-gate-h3 font-semibold text-gate-ink">
        {t.lockoutTitle}
      </p>
      {counting ? (
        <Countdown
          expiresAt={new Date(until as number).toISOString()}
          lang={lang}
          label={t.lockoutLabel}
          expiredLabel={t.countdownExpired}
          minutesRemaining={t.minutesRemaining}
          lessThanMinute={t.lessThanMinute}
        />
      ) : null}
      <p className="max-w-[40ch] text-gate-body text-gate-ink-2">
        {t.lockoutBody}
      </p>
      {!counting && !serverLocked ? (
        <Button variant="secondary" fullWidth onClick={onRetry}>
          {t.errorRetry}
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirming / Success / Review / Terminal                                    */
/* -------------------------------------------------------------------------- */

function ConfirmingPanel({ t }: { t: PayCopy }) {
  return (
    <div className="flex flex-col items-center gap-gate-16 py-gate-8 text-center">
      <span className="relative grid size-16 place-items-center rounded-gate-pill bg-gate-accent-soft">
        <span
          className="absolute size-12 animate-ping rounded-gate-pill bg-gate-accent/20 motion-reduce:animate-none"
          aria-hidden="true"
        />
        <Clock className="size-6 text-gate-accent" aria-hidden="true" />
      </span>
      <h2 className="text-gate-h2 font-semibold text-gate-ink">
        {t.confirmingTitle}
      </h2>
      <p className="max-w-[38ch] text-gate-body text-gate-ink-2">
        {t.confirmingBody}
      </p>
    </div>
  );
}

function PaidPanel({
  data,
  t,
  orderId,
  target,
}: {
  data: PayLink;
  t: PayCopy;
  orderId: string | null;
  target: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-gate-16 py-gate-8 text-center">
      <DrawnCheck />
      <h2 className="text-gate-h2 font-semibold text-gate-ink">
        {t.paidTitle}
      </h2>
      <p className="max-w-[34ch] text-gate-body text-gate-ink-2">
        {t.paidBody}
      </p>

      <div className="flex w-full items-center justify-between gap-gate-12 rounded-gate-input bg-gate-surface-2 p-gate-16">
        <span className="text-gate-caption text-gate-ink-2">
          {t.orderIdLabel}
        </span>
        <span className="font-gate-mono text-gate-mono break-all text-gate-ink">
          {orderId ?? data.id}
        </span>
      </div>

      <BackToShopButton target={target} t={t} />
    </div>
  );
}

function ReviewPanel({
  data,
  t,
  lang,
  reason,
  received,
  target,
}: {
  data: PayLink;
  t: PayCopy;
  lang: Lang;
  reason: PayLink["review_reason"];
  received: number | null;
  target: string | null;
}) {
  const reasonCopy = reason ? t.reviewReasons[reason] : null;
  const body =
    received !== null && received !== data.amount
      ? t.reviewMismatch(
          formatBDT(received, lang),
          formatBDT(data.amount, lang),
        )
      : t.reviewHeld;

  return (
    <div className="flex flex-col items-center gap-gate-12 py-gate-8 text-center">
      <span className="grid size-14 place-items-center rounded-gate-pill bg-gate-warning/10">
        <AlertTriangle className="size-6 text-gate-warning" aria-hidden="true" />
      </span>
      <h2 className="text-gate-h2 font-semibold text-gate-ink">
        {t.reviewTitle}
      </h2>
      <p className="max-w-[40ch] text-gate-body text-gate-ink-2">{body}</p>
      <p className="flex items-center gap-gate-8 text-gate-body font-medium text-gate-ink">
        <Check className="size-4 shrink-0 text-gate-success" aria-hidden="true" />
        {t.reviewReassure}
      </p>
      {reasonCopy ? (
        <p className="max-w-[40ch] text-gate-caption text-gate-ink-2">
          {reasonCopy}
        </p>
      ) : null}
      <BackToShopButton target={target} t={t} />
    </div>
  );
}

function ExpiredPanel({ target, t }: { target: string | null; t: PayCopy }) {
  return (
    <TerminalPanel
      icon={
        <CircleSlash2 className="size-6 text-gate-ink-2" aria-hidden="true" />
      }
      title={t.expiredTitle}
      body={t.expiredBody}
      action={<BackToShopButton target={target} t={t} />}
    />
  );
}

function TerminalPanel({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-gate-12 py-gate-8 text-center">
      <span className="grid size-14 place-items-center rounded-gate-pill bg-gate-surface-2">
        {icon}
      </span>
      <h2 className="text-gate-h2 font-semibold text-gate-ink">{title}</h2>
      <p className="max-w-[38ch] text-gate-body text-gate-ink-2">{body}</p>
      {action ? <div className="mt-gate-4 w-full">{action}</div> : null}
    </div>
  );
}

function BackToShopButton({ target, t }: { target: string | null; t: PayCopy }) {
  if (!target) return null;
  return (
    <Button
      variant="secondary"
      fullWidth
      onClick={() => window.location.assign(target)}
    >
      {t.backToShop}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Verification overlay                                                        */
/* -------------------------------------------------------------------------- */

function VerifyingOverlay({ t }: { t: PayCopy }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="gate-verifying-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-gate-bg/80 p-gate-24 backdrop-blur-[2px]"
    >
      <div className="flex w-full max-w-[22rem] flex-col items-center gap-gate-16 rounded-gate-sheet border border-gate-border bg-gate-surface p-gate-24 text-center">
        <span className="relative grid size-20 place-items-center">
          <span
            className="absolute size-20 animate-ping rounded-gate-pill bg-gate-accent/20 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span className="relative grid size-16 place-items-center rounded-gate-pill bg-gate-accent-soft">
            <Hourglass className="size-7 text-gate-accent" aria-hidden="true" />
          </span>
        </span>
        <h2
          id="gate-verifying-title"
          className="text-gate-h3 font-semibold text-gate-ink"
        >
          {t.verifyingTitle}
        </h2>
        <p className="text-gate-body text-gate-ink-2">{t.verifyingBody}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared chrome                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The one card every live payment state renders inside: provider + status chip
 * + amount header, then a state-specific body (SPEC_v3 §10 "wallet+amount+ref").
 */
function PaymentCard({
  data,
  t,
  lang,
  chip,
  children,
}: {
  data: PayLink;
  t: PayCopy;
  lang: Lang;
  chip: ChipStatus;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-gate-card border border-gate-border bg-gate-surface">
      <div className="flex flex-col gap-gate-16 p-gate-20">
        <div className="flex items-center justify-between gap-gate-12">
          <ProviderBadge provider={data.provider} />
          <StatusChip status={chip} />
        </div>
        <div>
          <p className="text-gate-caption text-gate-ink-2">{t.amountLabel}</p>
          <p className="font-gate-mono text-gate-h1 font-semibold tabular-nums text-gate-ink">
            {formatBDT(data.amount, lang)}
          </p>
        </div>
      </div>
      <div className="border-t border-gate-border p-gate-20">{children}</div>
    </section>
  );
}

function Countdown({
  expiresAt,
  lang,
  label,
  expiredLabel,
  minutesRemaining,
  lessThanMinute,
}: {
  expiresAt: string;
  lang: Lang;
  label: string;
  expiredLabel: string;
  minutesRemaining: (n: number) => string;
  lessThanMinute: string;
}) {
  const [now, setNow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, []);

  const target = new Date(expiresAt).getTime();
  const total =
    now === null || Number.isNaN(target)
      ? null
      : Math.max(0, Math.floor((target - now) / 1000));

  const urgent = total !== null && total > 0 && total <= 300;
  const expired = total === 0;
  const minutes = total === null ? 0 : Math.ceil(total / 60);
  const a11y =
    total === null
      ? ""
      : total === 0
        ? expiredLabel
        : total < 60
          ? lessThanMinute
          : minutesRemaining(minutes);

  return (
    <div className="flex flex-col items-center gap-gate-8">
      <div
        className={cn(
          "inline-flex items-center gap-gate-8 rounded-gate-pill border px-gate-12 py-gate-8",
          urgent
            ? "border-gate-warning/40 bg-gate-warning/10"
            : "border-gate-border bg-gate-surface-2",
        )}
      >
        {urgent ? (
          <AlertTriangle
            className="size-4 shrink-0 text-gate-warning"
            aria-hidden="true"
          />
        ) : (
          <Clock className="size-4 shrink-0 text-gate-ink-2" aria-hidden="true" />
        )}
        <span className="text-gate-caption font-medium text-gate-ink-2">
          {expired ? expiredLabel : label}
        </span>
        <span
          aria-hidden="true"
          className="font-gate-mono text-gate-mono font-semibold tabular-nums text-gate-ink"
        >
          {total === null ? "--:--" : formatCountdown(total, lang)}
        </span>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {a11y}
      </span>
    </div>
  );
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-gate-16">
      <span className="sr-only">{label}</span>
      <div className="h-36 animate-pulse rounded-gate-card border border-gate-border bg-gate-surface motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-gate-card border border-gate-border bg-gate-surface motion-reduce:animate-none" />
    </div>
  );
}

export function BrandMark() {
  return (
    <span className="inline-flex items-center gap-gate-8">
      <span className="grid size-7 place-items-center rounded-gate-input bg-gate-ink text-gate-caption font-semibold text-gate-bg">
        P
      </span>
      <span className="text-gate-h3 font-semibold tracking-tight text-gate-ink">
        PayGate
      </span>
    </span>
  );
}

function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <span className="inline-flex items-center gap-gate-8">
      <span
        className={cn(
          "size-3 shrink-0 rounded-gate-pill",
          PROVIDER_DOT[provider],
        )}
        aria-hidden="true"
      />
      <span className="text-gate-h3 font-semibold text-gate-ink">
        {PROVIDER_LABELS[provider]}
      </span>
    </span>
  );
}

function LanguageToggle({
  lang,
  onChange,
  t,
}: {
  lang: Lang;
  onChange: (lang: Lang) => void;
  t: PayCopy;
}) {
  const options: { code: Lang; label: string }[] = [
    { code: "en", label: t.langEnglish },
    { code: "bn", label: t.langBangla },
  ];

  return (
    <div
      role="group"
      aria-label={t.langLabel}
      className="inline-flex items-center rounded-gate-pill border border-gate-border bg-gate-surface p-gate-4"
    >
      {options.map(({ code, label }) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(code)}
            className={cn(
              "inline-flex h-11 min-w-[44px] items-center justify-center rounded-gate-pill px-gate-12 text-gate-caption font-medium",
              "transition-colors duration-[120ms] ease-gate",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gate-accent",
              active
                ? "bg-gate-ink text-gate-bg"
                : "text-gate-ink-2 hover:bg-gate-surface-2",
            )}
          >
            {code === "bn" ? <span className="font-gate-bn">{label}</span> : label}
          </button>
        );
      })}
    </div>
  );
}

/** Map the API status onto the Gate status chip vocabulary. */
function toChipStatus(status: PaymentStatus): ChipStatus {
  switch (status) {
    case "created":
      return "pending";
    case "awaiting_payment":
      return "awaiting_payment";
    case "confirming":
      return "awaiting_payment";
    case "paid":
      return "paid";
    case "expired":
      return "expired";
    case "needs_review":
      return "needs_review";
    case "cancelled":
      return "failed";
  }
}
