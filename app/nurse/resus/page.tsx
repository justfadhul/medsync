import type { Metadata } from "next";

import { canAdminCloseResus } from "@/lib/resus/authority";
import { fetchResusBoard } from "@/lib/resus/board";
import { fetchResusBoardV2 } from "@/lib/resus/board-v2";
import { resusDeskV2 } from "@/lib/resus/feature";
import { requireResusScope } from "@/lib/resus/scope";
import { cn } from "@/lib/utils";
import { ResusBoardV2 } from "./_components/board-v2";
import { ResusBoard } from "./_components/resus-board";

export const metadata: Metadata = {
  title: "Resus · MedSync",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * /nurse/resus — the resus board. The trigger + shared entry for the
 * ABCDE resuscitation surface: active episodes to converge on, and
 * Red/L1 triage records with no episode yet (recognition → call → open).
 */
export default async function ResusBoardPage() {
  const scope = await requireResusScope();
  if (resusDeskV2()) {
    const [boardV2, canAdminClose] = await Promise.all([
      fetchResusBoardV2({ hospitalId: scope.hospitalId, clinicianUserId: scope.userId }),
      canAdminCloseResus(scope.userId, scope.hospitalId, scope.cadreCode),
    ]);
    return (
      <ResusBoardV2
        board={boardV2}
        basePath="/nurse/resus"
        me={{
          canAdminClose,
          leaderRecommended: scope.leaderRecommended,
          place: `${scope.hospitalName} · ${scope.departmentName}`,
        }}
      />
    );
  }
  const board = await fetchResusBoard({
    hospitalId: scope.hospitalId,
    clinicianUserId: scope.userId,
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-9">
      <header className="flex flex-col gap-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] uppercase">
          <span
            aria-hidden
            className={cn(
              "size-1 rounded-full bg-rose-500 ring-2 ring-rose-500/20",
              board.active.length > 0 && "pulse-dot",
            )}
          />
          {scope.hospitalName} · {scope.departmentName} · Resus
        </span>
        <h1 className="font-display text-display-s text-foreground">Resuscitation board</h1>
        <p className="text-muted-foreground text-body-s max-w-2xl leading-relaxed">
          The ABCDE surface for any patient at Red/L1 or a Step-0 life-threat. Opening a resus
          starts the immutable record and summons the team. The app records what the team does — the
          clinician leads.
        </p>
        <div className="h-px w-10 bg-rose-500/50 dark:bg-rose-400/40" aria-hidden />
      </header>

      <ResusBoard board={board} leaderRecommended={scope.leaderRecommended} />
    </div>
  );
}
