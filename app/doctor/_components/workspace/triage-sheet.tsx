"use client";

import type { TriageSubmitState } from "@/app/nurse/triage/actions";
import type { TriageWorklistRow } from "@/lib/triage/worklist";
import type { Acuity, FlowIdentity } from "@/lib/workspace/flow";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SirenIcon } from "lucide-react";

import { AMBER_CHIP } from "@/app/nurse/resus/[episodeId]/_components/v2/close-out-words";
import { openResusFromIntake } from "@/app/nurse/resus/actions";
import { AssignDoctorButton } from "@/app/nurse/triage/_components/assign-doctor-button";
import { TriageDesk } from "@/app/nurse/triage/_components/triage-desk";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ACUITY_TIERS } from "@/lib/triage/constants";
import { cn } from "@/lib/utils";
import { takePatientAction } from "../../_lib/workspace-actions";
import { AcuityChip } from "./acuity-chip";
import { patientMeta, patientTitle } from "./patient-line";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./row-actions";

function identityOf(row: TriageWorklistRow): FlowIdentity {
  return {
    name: row.displayName,
    code: row.patientCode,
    ageYears: row.ageYears,
    sex: row.sex,
    unknownLabel: row.patientUnknownLabel,
  };
}

/**
 * The triage desk in a sheet over the board (E1). On submit the sheet stays
 * and says the result and the next step — Take & start, Assign to…, or back —
 * so triage to an open encounter is one more tap and no list page (§4 budget).
 * A Red/L1 result or a Step-0 life threat puts Open resus first; the other
 * steps stay (decision support, never a block).
 */
export function TriageSheet({
  row,
  mayDownTriage,
  openResusOnArrest,
}: {
  row: TriageWorklistRow | null;
  mayDownTriage: boolean;
  openResusOnArrest: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<TriageSubmitState | null>(null);
  const close = () => router.back();
  const identity = row ? identityOf(row) : null;

  return (
    <Sheet open onOpenChange={(open) => (open ? null : close())}>
      <SheetContent
        side="right"
        widthClassName={
          result || !row ? "w-full sm:max-w-[480px]" : "w-full lg:w-[min(1180px,94vw)]"
        }
      >
        {!row || !identity ? (
          <>
            <SheetHeader>
              <SheetTitle>Triage</SheetTitle>
              <SheetDescription>This visit is no longer waiting for triage.</SheetDescription>
            </SheetHeader>
          </>
        ) : result ? (
          <TriageResult row={row} identity={identity} result={result} onBack={close} />
        ) : (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Triage · {patientTitle(identity)}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TriageDesk
                row={row}
                mayDownTriage={mayDownTriage}
                basePath="/doctor"
                resusBase="/doctor/resus"
                openResusOnArrest={openResusOnArrest}
                onSubmitted={setResult}
                backLabel="Back to board"
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TriageResult({
  row,
  identity,
  result,
  onBack,
}: {
  row: TriageWorklistRow;
  identity: FlowIdentity;
  result: TriageSubmitState;
  onBack: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const level = (result.assignedLevel ?? null) as Acuity | null;
  const tier = ACUITY_TIERS.find((t) => t.level === level);
  const resusFirst = level === 1 || result.lifeThreat === true;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string } | void>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r && r.error) setError(r.error);
    });
  const openResus = () => run(() => openResusFromIntake(row.intakeId, "/doctor/resus"));
  const take = () => run(() => takePatientAction({ intakeId: row.intakeId }));

  return (
    <>
      <SheetHeader>
        <SheetTitle>Triage result</SheetTitle>
        <SheetDescription>
          {patientTitle(identity)}
          {patientMeta(identity) ? ` · ${patientMeta(identity)}` : ""}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AcuityChip level={level} />
            {tier ? <span className="text-body-m text-foreground">{tier.meaning}</span> : null}
          </div>
          {result.why ? (
            <p className="text-body-s text-muted-foreground">Why: {result.why}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {resusFirst ? (
            <button type="button" disabled={pending} onClick={openResus} className={PRIMARY_BUTTON}>
              <SirenIcon aria-hidden className="size-4" />
              Open resus
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending || !row.patientUserId}
            onClick={take}
            className={resusFirst ? SECONDARY_BUTTON : PRIMARY_BUTTON}
          >
            {pending ? "Starting…" : "Take & start"}
          </button>
          {row.patientUserId ? (
            <div className="border-border flex min-h-11 items-center rounded-md border">
              <AssignDoctorButton intakeId={row.intakeId} />
            </div>
          ) : (
            <p className="text-body-s text-muted-foreground">
              Register the patient before a doctor can be assigned.
            </p>
          )}
          <button type="button" onClick={onBack} className={cn(SECONDARY_BUTTON, "border-0")}>
            Back to board
          </button>
        </div>
        {error ? (
          <p role="alert" className={cn("text-body-s rounded-md px-3 py-2", AMBER_CHIP)}>
            {error}
          </p>
        ) : null}
      </SheetBody>
    </>
  );
}
