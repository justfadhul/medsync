import type { LabNavEntry } from "./_components/lab-nav";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { SignOutButton } from "@/components/medsync/sign-out-button";
import { emrV1LiveFor } from "@/lib/emr/feature";
import { requireLabTechScope } from "@/lib/lab-tech/scope";
import { loadLabWorklist as loadLegacyWorklist } from "@/lib/lab-tech/worklist";
import { navFor } from "@/lib/lab/nav";
import { labWorklistFor, rejectedFor, releasedTodayFor } from "@/lib/lab/page-data";
import { cn } from "@/lib/utils";
import { LabShell } from "./_components/lab-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The laboratory workspace. Auth: `requireLabTechScope()` enforces auth + AAL2/MFA + an active
 * AHPC lab affiliation, and, where LAB_WORKSPACE is on, `lab.view` (lib/lab/access.ts).
 *
 * LAB_WORKSPACE on (Lab Phase 0): the workspace shell, with the registered navigation and its
 * counts. Off: the original top bar, unchanged (Law 11).
 */
export default async function LabLayout({ children }: { children: ReactNode }) {
  const scope = await requireLabTechScope();
  if (!scope.workspaceLive) return <LegacyLabLayout scope={scope}>{children}</LegacyLabLayout>;

  const emr = emrV1LiveFor(scope.hospitalId);
  const [open, released, rejected] = emr
    ? await Promise.all([
        labWorklistFor(scope.hospitalId).then((w) => w.inputs.length),
        releasedTodayFor(scope.hospitalId).then((r) => r.length),
        rejectedFor(scope.hospitalId).then((r) => r.length),
      ])
    : [(await loadLegacyWorklist(scope.hospitalId)).length, 0, 0];
  const counts = { worklist: open, released, rejected };
  const words = {
    worklist: `${open} waiting`,
    released: `${released} released today`,
    rejected: `${rejected} rejected in 7 days`,
  };
  const nav: LabNavEntry[] = navFor(scope.access.permissions).map((i) => ({
    id: i.id,
    label: i.label,
    href: i.href,
    exact: i.exact,
    count: counts[i.id],
    countLabel: words[i.id],
  }));
  return (
    <LabShell
      scope={scope}
      sectionName={scope.sectionIds.length ? scope.departmentName : null}
      nav={nav}
    >
      {children}
    </LabShell>
  );
}

/** The pre-Phase-0 lab top bar, byte for byte, for hospitals with LAB_WORKSPACE off. */
function LegacyLabLayout({
  scope,
  children,
}: {
  scope: Awaited<ReturnType<typeof requireLabTechScope>>;
  children: ReactNode;
}) {
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
            href="/accounts"
            className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline"
          >
            Switch account
          </Link>
          <SignOutButton className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-4 transition-colors hover:underline" />
        </div>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
