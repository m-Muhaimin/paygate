"use client";

import { PayLinkInvalid } from "@/components/app/pay-link-invalid";
import { DICTIONARIES } from "@/lib/client/i18n";

import { BrandMark } from "./pay-client";

/**
 * Route-segment not-found boundary for `/pay/[id]`. Self-contained: the pay
 * directory has no layout, so an unknown id renders this page (Next 16) rather
 * than the route-level client 404 state (which runs when the API returns 404
 * for a syntactically-valid id).
 */
export default function PayNotFound() {
  const t = DICTIONARIES.en;
  return (
    <div className="flex min-h-dvh flex-col bg-gate-bg text-gate-ink">
      <header className="mx-auto flex w-full max-w-[26rem] items-center justify-between px-gate-16 py-gate-16">
        <BrandMark />
        <span className="sr-only">{t.langLabel}</span>
      </header>
      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center px-gate-16 pb-gate-40">
        <PayLinkInvalid
          title={t.invalidTitle}
          description={t.invalidBody}
          homeLabel={t.invalidHome}
        />
      </main>
    </div>
  );
}