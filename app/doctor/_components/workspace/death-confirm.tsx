"use client";

import type { PatientFlowRow } from "@/lib/workspace/flow";
import { useState } from "react";

import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "./buttons";
import { patientTitle } from "./patient-line";

/**
 * Starting care for a patient recorded as dead (§5.4, Law 2): a confirm with
 * a required reason, audited before anything opens. Correcting a wrong death
 * record is not done here — it belongs to the record that holds it.
 */
export default function DeathConfirm({
  row,
  open,
  pending,
  onCancel,
  onConfirm,
}: {
  row: PatientFlowRow;
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 8;
  const died = row.badges.find((b) => b.text.startsWith("Died"))?.text ?? "Recorded as died";
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <SheetContent side="center" widthClassName="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{died} — continue anyway?</SheetTitle>
          <SheetDescription>
            {patientTitle(row.identity)} is recorded as having died. Starting an encounter needs a
            reason, which is kept in the audit log.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-2">
          <label htmlFor={`override-${row.key}`} className="text-caption text-muted-foreground">
            Reason (required)
          </label>
          <textarea
            id={`override-${row.key}`}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="border-input bg-card text-foreground text-body-s focus-visible:shadow-focus w-full rounded-sm border px-2.5 py-2 outline-none focus-visible:border-teal-500"
          />
        </SheetBody>
        <SheetFooter>
          <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
            Keep as it is
          </button>
          <button
            type="button"
            disabled={!ok || pending}
            className={PRIMARY_BUTTON}
            onClick={() => onConfirm(reason.trim())}
          >
            Start encounter
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
