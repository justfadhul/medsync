"use client";

import type { AssignableDoctor } from "@/lib/encounter/assignment";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon, UserPlusIcon, XIcon } from "lucide-react";

import { assignDoctorAction, listAssignableDoctorsAction } from "../actions";

/**
 * Nurse "assign a doctor" control for a triaged patient (compact, fits the
 * worklist row's action slot). Loads the department's doctors on open, assigns
 * the patient (a `planned` encounter), and refreshes. Reassigning just picks
 * another doctor. Decision-support: it routes the patient; the doctor starts.
 */
export function AssignDoctorButton({ intakeId }: { intakeId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [doctors, setDoctors] = useState<AssignableDoctor[] | null>(null);
  const [pick, setPick] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openPicker() {
    setOpen(true);
    setError(null);
    if (doctors === null) {
      startTransition(async () => {
        setDoctors(await listAssignableDoctorsAction());
      });
    }
  }

  function confirm() {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      const res = await assignDoctorAction(intakeId, pick);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(true);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="tap text-muted-foreground hover:bg-muted/40 hover:text-foreground text-caption flex shrink-0 items-center gap-1 px-3 font-medium transition-colors"
      >
        <UserPlusIcon className="size-3.5" aria-hidden />
        {done ? "Reassign" : "Assign Dr"}
      </button>
    );
  }

  return (
    <div className="scale-in flex shrink-0 items-center gap-1 px-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        disabled={doctors === null || pending}
        className="border-input bg-card text-foreground text-caption focus-visible:border-ring max-w-[150px] rounded-sm border px-1.5 py-1 outline-none"
      >
        <option value="">{doctors === null ? "Loading…" : "Doctor…"}</option>
        {(doctors ?? []).map((d) => (
          <option key={d.userId} value={d.userId}>
            {d.fullName}
            {d.inDepartment ? " · dept" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={confirm}
        disabled={pending || !pick}
        aria-label="Confirm assignment"
        className="tap text-mint-700 hover:text-mint-800 dark:text-mint-400 transition-colors disabled:opacity-40"
      >
        <CheckIcon className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancel"
        className="tap text-muted-foreground hover:text-foreground transition-colors"
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>
      {error ? <span className="text-destructive text-[10px]">{error}</span> : null}
    </div>
  );
}
