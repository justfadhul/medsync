"use client";

import { useState, useTransition } from "react";
import { ZapIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { openResusFromTriage } from "../../resus/actions";
import { rapidRedAction } from "../actions";

/**
 * Rapid mode (kickoff §4): the obvious-sick fast path. One tap opens a
 * tiny confirm — pick the life-threat, confirm — and the patient becomes
 * a Level-1 resus triage WITHOUT the full form. You don't fill a form
 * for a patient in arrest. Routes through the audited rapidRedAction; it
 * can only ever over-triage (assigns L1), never under-triage.
 *
 * The action is dispatched inside a transition (not useActionState +
 * effect), so the dialog closes from the resolved callback — no
 * setState-in-effect cascade.
 */

const LIFE_THREATS = [
  "Airway compromise / stridor",
  "Absent or agonal breathing",
  "No palpable pulse / cardiac arrest",
  "Unresponsive",
  "Active / status seizure",
  "Exsanguinating haemorrhage",
  "Critically low SpO₂",
] as const;

/** Resus Desk v2 S0: this reason opens the resus straight into the arrest (server side). */
const ARREST_REASON: (typeof LIFE_THREATS)[number] = "No palpable pulse / cardiac arrest";

export function RapidRedButton({
  intakeId,
  patientUserId,
  patientLabel,
  openResusOnArrest = false,
  resusBase = "/nurse/resus",
}: {
  intakeId: string;
  patientUserId: string | null;
  patientLabel: string;
  /**
   * Resus Desk v2 (S0) — the server page passes `resusDeskV2()`. When on and the
   * reason is "no palpable pulse", a successful rapid Red opens the resus at once
   * (arrest recorded, desk in arrest mode) instead of staying on the board.
   */
  openResusOnArrest?: boolean;
  /** Workspace base the opened resus lands in (/nurse/resus or /doctor/resus). */
  resusBase?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(LIFE_THREATS[0]);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Redirects to the desk on success; returns only on error. */
  async function openArrestResus(triageRecordId: string) {
    const opened = await openResusFromTriage(triageRecordId, resusBase);
    setError(`Level 1 is recorded, but the resus did not open: ${opened.error} Try again.`);
  }

  function confirm() {
    setError(null);
    const fd = new FormData();
    fd.set("intake_id", intakeId);
    if (patientUserId) fd.set("patient_user_id", patientUserId);
    fd.set("reason", reason);
    startTransition(async () => {
      // S0 retry: the Level 1 is already recorded — only re-open, never re-triage.
      if (openedFor) return openArrestResus(openedFor);
      const res = await rapidRedAction({}, fd);
      if (res.ok && openResusOnArrest && reason === ARREST_REASON && res.triageRecordId) {
        setOpenedFor(res.triageRecordId);
        await openArrestResus(res.triageRecordId);
      } else if (res.ok) {
        setOpen(false);
      } else {
        setError(res.error ?? "Could not record the resus triage. Please try again.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="tap text-caption mr-3 shrink-0 gap-1 self-center bg-rose-600 font-semibold text-white hover:bg-rose-700"
        title="Declare an immediate life threat — Level 1, resus now"
      >
        <ZapIcon className="size-3" aria-hidden />
        Resus
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-0 p-0">
          <DialogHeader className="border-border flex flex-col gap-1 border-b px-5 py-4 text-left">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
              <ZapIcon className="size-2.5" aria-hidden />
              Rapid · Level 1 resus
            </span>
            <DialogTitle className="text-heading-s leading-tight">
              Immediate life threat — {patientLabel}
            </DialogTitle>
            <DialogDescription className="text-[12px]">
              This assigns Level 1 (resuscitate now) and alerts the team — bypassing the full
              assessment. Confirm the reason.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5 px-5 py-4">
            {LIFE_THREATS.map((lt) => (
              <label
                key={lt}
                className={cn(
                  "tap text-body-s flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition-colors",
                  reason === lt
                    ? "border-rose-500/50 bg-rose-50/60 dark:bg-rose-950/20"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="rapid_reason_choice"
                  value={lt}
                  checked={reason === lt}
                  onChange={() => setReason(lt)}
                  className="size-3.5 accent-rose-600"
                />
                {lt}
              </label>
            ))}
          </div>

          {error ? <p className="text-destructive px-5 text-[12px]">{error}</p> : null}

          <div className="border-border bg-muted/40 flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="tap bg-rose-600 text-white hover:bg-rose-700"
            >
              {pending ? "Recording…" : "Confirm — Level 1 resus"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
