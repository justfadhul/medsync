"use client";

import type { AssignableDoctor, AssignedEncounterRow } from "@/lib/encounter/assignment";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRightLeftIcon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  listDoctorsForReassignAction,
  reassignEncounterAction,
  startEncounterFromTriageAction,
} from "../../encounters/actions";

const ACUITY_CHIP: Record<number, string> = {
  1: "bg-rose-100 text-rose-700 ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300",
  2: "bg-orange-100 text-orange-700 ring-orange-200/70 dark:bg-orange-950/40 dark:text-orange-300",
  3: "bg-amber-100 text-amber-800 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300",
  4: "bg-emerald-100 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300",
  5: "bg-sky-100 text-sky-700 ring-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300",
};

const SELECT =
  "border-input bg-card text-foreground rounded-sm border px-2 py-1.5 text-[12.5px] outline-none transition-[border-color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring";

export function AssignedRow({ row }: { row: AssignedEncounterRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [reassigning, setReassigning] = useState(false);
  const [doctors, setDoctors] = useState<AssignableDoctor[] | null>(null);
  const [pick, setPick] = useState("");

  function start() {
    if (!row.triageRecordId) {
      setError("This assignment has no triage link.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // Redirects to the clerking surface on success; only returns on failure.
      const res = await startEncounterFromTriageAction(row.triageRecordId!);
      if (res && !res.ok) setError(res.error);
    });
  }

  function openReassign() {
    setReassigning(true);
    if (doctors === null) {
      startTransition(async () => {
        setDoctors(await listDoctorsForReassignAction());
      });
    }
  }

  function confirmReassign() {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      const res = await reassignEncounterAction(row.encounterId, pick);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReassigning(false);
      router.refresh();
    });
  }

  return (
    <li className="border-border bg-card card-lift flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {row.acuity ? (
            <span
              className={`scale-in inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ${
                ACUITY_CHIP[row.acuity] ?? "bg-muted text-muted-foreground ring-border"
              }`}
            >
              L{row.acuity}
            </span>
          ) : null}
          <span className="text-foreground font-mono text-[12.5px] tabular-nums">
            {row.patientCode ?? "—"}
          </span>
          {row.presentingComplaint ? (
            <span className="text-muted-foreground text-[12.5px]">· {row.presentingComplaint}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" onClick={start} disabled={pending}>
            <PlayIcon className="size-3.5" aria-hidden />
            {pending ? "…" : "Start"}
          </Button>
          <Button type="button" variant="secondary" onClick={openReassign} disabled={pending}>
            <ArrowRightLeftIcon className="size-3.5" aria-hidden />
            Reassign
          </Button>
        </div>
      </div>

      {reassigning ? (
        <div className="reveal-up flex flex-wrap items-center gap-2">
          <select
            className={SELECT}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={doctors === null}
          >
            <option value="">{doctors === null ? "Loading doctors…" : "Choose a doctor…"}</option>
            {(doctors ?? []).map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.fullName}
                {d.inDepartment ? " · this dept" : ""}
              </option>
            ))}
          </select>
          <Button type="button" onClick={confirmReassign} disabled={pending || !pick}>
            Confirm
          </Button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground tap rounded-sm px-1 text-[12px] underline-offset-4 transition-colors hover:underline"
            onClick={() => setReassigning(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive scale-in text-[12px]" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
