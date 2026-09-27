"use client";

import type { PrescribeSheetPatient } from "./model";
import type { PrescriptionItem } from "./views";
import dynamic from "next/dynamic";
import { useState } from "react";

import { PrescriptionsView } from "./views";

// The formulary and the checks load with the sheet, on first open (the clerking route's JS budget).
const PrescribeSheet = dynamic(() => import("./sheet").then((m) => m.PrescribeSheet), {
  ssr: false,
});

/** The desk's prescribing island: the visit's prescriptions and, once opened, the prescribe dialog. */
export function PrescriptionsPanel({
  encounterId,
  patientUserId,
  identity,
  patient,
  items,
}: {
  encounterId: string;
  patientUserId: string;
  identity: { name: string; mrn: string };
  patient: PrescribeSheetPatient;
  items: readonly PrescriptionItem[];
}) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <>
      <PrescriptionsView
        identity={identity}
        items={items}
        printHref={`/doctor/encounters/${encounterId}/print/prescription`}
        onPrescribe={() => {
          setOpened(true);
          setOpen(true);
        }}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      {opened ? (
        <PrescribeSheet
          open={open}
          onOpenChange={setOpen}
          encounterId={encounterId}
          patientUserId={patientUserId}
          identity={identity}
          patient={patient}
          onDone={(s) => {
            setSaid(s);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
