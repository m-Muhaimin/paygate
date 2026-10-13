import type { Metadata } from "next";

import { AppShell } from "@/components/app/app-shell";
import { AppProviders } from "@/components/app/providers";

export const metadata: Metadata = {
  title: "PayGate Console",
};

/**
 * Applies the persisted theme before the shell paints so there is no flash of
 * the wrong surface colour. Kept inline (and tiny) on purpose.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem("paygate-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);}catch(e){}})();`;

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </>
  );
}
