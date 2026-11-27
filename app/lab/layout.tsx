import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { DutyChip } from "@/components/rota/duty-chip";
import { requireLabTechScope } from "@/lib/lab-tech/scope";
import { tetherDesk } from "@/lib/landing/tether-host";
import { dutyRotaLiveFor } from "@/lib/rota/feature";
import { myDuties } from "@/lib/rota/read";
import { soft } from "@/lib/rota/soft";
import { cn } from "@/lib/utils";
import { LabShellV2 } from "./_components/v2/shell";
import { labV2 } from "./_lib/places";
import { shellPayload } from "./_lib/shell-payload";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The laboratory workspace. Auth: `requireLabTechScope()` enforces auth + AAL2/MFA + an active
 * AHPC lab affiliation, and, where LAB_WORKSPACE is on, `lab.view` (lib/lab/access.ts).
 *
 * LAB_WORKSPACE on with EMR v1 (Lab Workspace v2, ADRs 0343, 0349): the six-place shell. Otherwise the
 * original top bar, unchanged (Law 11): the older list at hospitals not yet on the record.
 */
export default async function LabLayout({ children }: { children: ReactNode }) {
  const scope = await requireLabTechScope();
  // ADR 0545: on Tether, a hospital TETHER_LAB names draws in the desk frame; any other goes to MedSync.
  const desk = await tetherDesk("/lab", scope.hospitalId);
  // Lab Workspace v2 (ADR 0349): the six-place shell wherever the workspace and the EMR are on.
  const v2 = scope.workspaceLive ? await labV2() : null;
  if (v2?.live) {
    // ADR 0545 §4: the duty rota's posts in the lab's department; rostered now, a plan, never proof of presence.
    const duties =
      desk && dutyRotaLiveFor(scope.hospitalId)
        ? (await soft(myDuties(scope.userId, scope.hospitalId, new Date()), [])).filter(
            (d) => d.state === "in_post",
          )
        : [];
    return (
      <LabShellV2
        payload={await shellPayload(v2)}
        desk={desk}
        duty={duties.length ? <DutyChip duties={duties} href={null} /> : null}
      >
        {children}
      </LabShellV2>
    );
  }
  return <LegacyLabLayout scope={scope}>{children}</LegacyLabLayout>;
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
