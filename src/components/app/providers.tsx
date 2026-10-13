"use client";

import { ToastProvider } from "@/components/gate";
import { QueryProvider } from "@/lib/client/query";

/** Client providers that wrap the whole authenticated app shell. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ToastProvider>{children}</ToastProvider>
    </QueryProvider>
  );
}
