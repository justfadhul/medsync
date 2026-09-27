import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { requireLabTechScope } from "@/lib/lab-tech/scope";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Minimal laboratory-technician workspace shell. Auth: `requireLabTechScope()`
 * enforces auth + AAL2/MFA + an active AHPC lab affiliation (server-enforced
 * cadre; non-lab users bounce). First pass is a focused worklist surface; the
 * accept/specimen/result-entry + verify-release write workflow lands next.
 */
export default async function LabLayout({ children }: { children: ReactNode }) {
  const scope = await requireLabTechScope();

  return (
    <div className="bg-background text-foreground flex min-h-svh w-full flex-col">
      <header className="border-border glass sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="font-display text-foreground text-body-m font-semibold">
            MedSync
          </Link>
          <span
            className="text-muted-foreground hidden truncate font-mono text-[10px] tracking-[0.12em] uppercase sm:inline"
            title={`${scope.hospitalName}${scope.departmentName ? ` · ${scope.departmentName}` : ""}`}
          >
            <span
              aria-hidden
              className="bg-grape-icon ring-grape-edge mr-1.5 inline-block size-1 -translate-y-px rounded-full ring-2"
            />
            Laboratory · {scope.hospitalName}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn("text-muted-foreground truncate text-[12px]", "hidden sm:inline")}
            title={scope.userEmail}
          >
            {scope.fullName ?? scope.userEmail}
          </span>
          <Link
            href="/sign-out"
            className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline"
          >
            Sign out
          </Link>
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
