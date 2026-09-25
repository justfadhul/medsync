"use client";

import type { PanelSection } from "./board-context";
import type { PatientFlowRow } from "@/lib/workspace/flow";

import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SECONDARY_BUTTON } from "./buttons";
import { patientTitle } from "./patient-line";
import { PatientPanel } from "./patient-panel";

/**
 * The patient panel below 1280 px: a right drawer on tablets, full screen on
 * phones (§5.2, §5.3). Loaded on demand — the board's first paint carries no
 * dialog library.
 */
export default function PanelSheet({
  open,
  row,
  section,
  onClose,
}: {
  open: boolean;
  row: PatientFlowRow | null;
  section: PanelSection | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" widthClassName="w-full sm:max-w-[440px]">
        {/* The panel names the patient itself; the sheet's title is for screen readers. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{row ? patientTitle(row.identity) : "Patient"}</SheetTitle>
        </SheetHeader>
        <SheetBody className="pt-14">
          {row ? (
            <PatientPanel row={row} section={section} />
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body-s text-muted-foreground">
                This patient is no longer on your board — their visit moved on or was closed.
              </p>
              <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
