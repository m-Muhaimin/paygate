import type { Metadata } from "next";

import { PayClient } from "./pay-client";

/**
 * Public, per-request hosted pay page. Never cached: status, countdown and
 * wallet assignment all change while the customer looks at it.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Complete your payment - PayGate",
  description:
    "Send your payment to the PayGate wallet shown, then keep this page open for live confirmation.",
  robots: { index: false, follow: false },
};

export default async function PayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PayClient paymentId={id} />;
}
